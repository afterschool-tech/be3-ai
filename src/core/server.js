require('dotenv').config();
const express = require('express');
const { queryAI, MODEL_ID, FALLBACK_MODEL_ID } = require('./aiService');
const { queryAI: queryGroqAI, MODEL_ID: GROQ_MODEL_ID } = require('./hfAiService');
const { getIntentClassificationPrompt } = require('../legacy/intents');
const { executeIntent } = require('../legacy/handlers');
const { resolveClauses } = require('../utils/clauseResolver');
const { CATEGORIES, VENDORS, CATEGORY_INVENTORY, ATTRIBUTES, COLLECTIONS, getContextSummary, getLeanContext } = require('../context/storeContext');
const { evaluateContextSufficiency } = require('../middleware/contextEvaluator');
const stateManager = require('../state/stateManager');
const redisClient = require('../state/redis');
const cors = require('cors');
const { isConfirmation, isImplicitReference, extractSuggestion, checkSuggestionAcknowledgement } = require('../middleware/suggestionHelper');
const { detectConversationalIntent, isResumeRequest } = require('../middleware/conversationalDetector');
const { trackRequest, getMetrics, getMetricsSummary } = require('../utils/metrics');
const { FEATURES, shouldUseToolSystem } = require('../middleware/featureFlags');
const { injectImages, extractImages } = require('../utils/imageInjector');
const { selectTools } = require('./toolSelector');
const { resolveDeterministic } = require('./deterministicResolver');
const { executeTools } = require('./orchestrator');
const { getMainSystemPrompt, getToolSystemPrompt, getLogicSystemPrompt, getPersonalityRewritePrompt } = require('./personalities');
const { logDebug, startRun } = require('../utils/debugLogger');
const fs = require('fs');

function logStep(msg) {
    const timestamp = new Date().toISOString();
    const entry = `[${timestamp}] ${msg}`;
    console.log(entry);
    try {
        fs.appendFileSync('ai_steps.log', `${entry}\n`);
    } catch (e) {
        console.error(`[LogStep] Failed to write to log file: ${e.message}`);
    }
}

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 3005;

/**
 * Stage 1: Classify user intent
 */
async function classifyIntent(userMessage, conversationHistory = []) {
    let classificationPrompt;

    if (FEATURES.contextIntegration) {
        classificationPrompt = getIntentClassificationPrompt(CATEGORIES, VENDORS, ATTRIBUTES, COLLECTIONS);
    } else {
        const categories = Object.values(CATEGORIES).map(c => c.label);
        const vendors = Object.values(VENDORS).map(v => v.label);
        classificationPrompt = getIntentClassificationPrompt(categories, vendors);
    }

    const messages = [
        { role: "system", content: classificationPrompt },
        ...conversationHistory.slice(-3).map(h => ({
            role: h.role === 'ai' ? 'assistant' : 'user',
            content: h.text
        })),
        { role: "user", content: userMessage }
    ];

    const response = await queryAI(messages, 256);
    console.log(`[AI] Classification response:`, response);

    try {
        let jsonStr = response.trim();
        if (jsonStr.includes('```json')) {
            const match = jsonStr.match(/```json\s*([\s\S]*?)\s*```/);
            if (match) jsonStr = match[1];
        } else if (jsonStr.includes('```')) {
            const match = jsonStr.match(/```\s*([\s\S]*?)\s*```/);
            if (match) jsonStr = match[1];
        }

        const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            jsonStr = jsonMatch[0];
        }

        jsonStr = jsonStr.substring(jsonStr.indexOf('{'), jsonStr.lastIndexOf('}') + 1);
        const classification = JSON.parse(jsonStr);

        return {
            intent: classification.intent || 'fallback_unknown',
            params: classification.params || {},
            confidence: classification.confidence !== undefined ? classification.confidence : 0.5
        };
    } catch (error) {
        console.error('[AI] Failed to parse classification:', error.message);
        return {
            intent: 'fallback_unknown',
            params: {},
            confidence: 0.0
        };
    }
}

/**
 * Stage 3: Generate natural language response from handler result
 */
async function generateResponse(userMessage, handlerResult, conversationHistory = []) {
    if (handlerResult.intent === 'fallback_unknown' || (handlerResult.confidence && handlerResult.confidence < 0.5)) {
        console.log(`[Unknown Recovery] Attempting to recover unknown intent with conversation context`);
        const contextualInfo = {
            conversation_history: conversationHistory.slice(-3).map(h => `${h.role}: ${h.text}`)
        };

        if (conversationHistory.length > 0) {
            const recoveryMessages = [
                {
                    role: "system",
                    content: `You are a super friendly, playful, and CUTE shopping assistant for the Be3 store. ✨👋
PERSONALITY:
- Vibe: Super warm, chatty, and enthusiastic!
- Tone: Casual and fun. 💖
CRITICAL: The user's message was classified as "unknown", but it might relate to context.
Recent conversation: ${JSON.stringify(contextualInfo, null, 2)}`
                },
                ...conversationHistory.slice(-5).map(h => ({
                    role: h.role === 'ai' ? 'assistant' : 'user',
                    content: h.text
                })),
                { role: "user", content: userMessage }
            ];

            try {
                const recoveryResponse = await queryGroqAI(recoveryMessages, 256, 0.4, 1, {}, GROQ_MODEL_ID);
                if (recoveryResponse && !recoveryResponse.toLowerCase().includes("not sure what you mean")) {
                    return recoveryResponse.trim();
                }
            } catch (error) {
                console.error('[Unknown Recovery] Recovery attempt failed:', error.message);
            }
        }
    }

    if (handlerResult.error) {
        return `I'm sorry, but ${handlerResult.error}`;
    }

    if (handlerResult.source === 'context') {
        const contextData = handlerResult.context_data;
        console.log(`[Response Generation] Using context grounding for ${contextData.type}`);

        let contextInstruction = `You are a super friendly, playful, and CUTE shopping assistant for the Be3 store. ✨👋
Context Data: ${JSON.stringify(contextData)}
Store Summary: ${JSON.stringify(getContextSummary())}`;

        const contextMessages = [
            { role: "system", content: contextInstruction },
            ...conversationHistory.slice(-5).map(h => ({
                role: h.role === 'ai' ? 'assistant' : 'user',
                content: h.text
            })),
            { role: "user", content: userMessage }
        ];

        try {
            return await queryGroqAI(contextMessages, 512, 0.3, 1, {}, GROQ_MODEL_ID);
        } catch (error) {
            console.error('[Response Generation] Context response failed:', error);
            return "I'm looking at our store information right now, and it seems we don't have that specific item in stock.";
        }
    }

    if ((handlerResult.intent === 'fallback_unknown' && !handlerResult.error) || handlerResult.intent === 'greeting') {
        const messages = [
            {
                role: "system",
                content: `You are a super friendly, playful, and CUTE shopping assistant for the Be3 store. ✨👋
Respond naturally and warmly to the user's conversational message!`
            },
            ...conversationHistory.slice(-5).map(h => ({
                role: h.role === 'ai' ? 'assistant' : 'user',
                content: h.text
            })),
            { role: "user", content: userMessage }
        ];

        try {
            const response = await queryGroqAI(messages, 512, 0.6, 1, {}, GROQ_MODEL_ID);
            if (response) return response.trim();
        } catch (e) {
            console.error('[AI] Conversational response failed:', e);
        }
    }

    if (handlerResult.message) {
        if (handlerResult.products || handlerResult.items || handlerResult.orders || handlerResult.product || handlerResult.advice) {
            let contextGrounding = "";
            if (FEATURES.contextIntegration) {
                contextGrounding = `\nSTORE CONTEXT SUMMARY:\n${JSON.stringify(getContextSummary(), null, 2)}\n`;
            }

            const messages = [
                { role: "system", content: getMainSystemPrompt(contextGrounding) },
                ...conversationHistory.slice(-10).map(h => ({
                    role: h.role === 'ai' ? 'assistant' : 'user',
                    content: h.text
                })),
                {
                    role: "user",
                    content: `User asked: "${userMessage}"\n\nData: ${JSON.stringify(handlerResult, null, 2)}`
                }
            ];

            try {
                const response = await queryGroqAI(messages, 1024, 0.2, 1, {}, GROQ_MODEL_ID);
                return response ? response.trim() : handlerResult.message;
            } catch (error) {
                console.error('[Stage 4] AI Generation failed:', error.message);
                return handlerResult.message;
            }
        }
        return handlerResult.message;
    }

    return JSON.stringify(handlerResult);
}

/**
     * Generate response based on tool results (Unified Be3 Voice)
     */
async function generateResponseFromTools(userMessage, toolResults, conversationHistory) {
    const { logDebug } = require('../utils/debugLogger');
    const contextSummary = JSON.stringify(getLeanContext());
    logDebug('SERVER:TOOL_RESULT_OPTIMIZATION', {
        _desc: 'Tool result optimization — trim product fields for prompt size',
        _example: 'Drop long HTML descriptions, keep name/price/vendor',
        inputToolCount: toolResults.length
    });
    const optimizedResults = toolResults.map(tr => {
        if (tr.result && (tr.result.products || tr.result.results)) {
            const rawProducts = tr.result.products || tr.result.results;
            return {
                ...tr,
                result: {
                    ...tr.result,
                    products: rawProducts.map(p => ({
                        id: p.id,
                        name: p.name || p.title,
                        price: p.price,
                        description: p.description ? (p.description.substring(0, 150) + '...') : null,
                        whatsapp_link: p.whatsapp_link,
                        checkout_url: p.checkout_url
                    }))
                }
            };
        }
        return tr;
    });

    const skippedActions = toolResults.filter(tr => tr.skipped && tr.skippedMessage);
    const skippedInstruction = skippedActions.length > 0
        ? `\nSKIPPED ACTIONS (same-turn): Some add-to-cart actions were skipped because the item wasn't resolved yet. You MUST tell the user: "${skippedActions[0].skippedMessage}" (or the same idea in your own words) so they know to say "add the first one" or "add the white one" in their next message.\n`
        : '';

    // Phase 7: Surface tool failures (cart.add / product.compare / cart.remove, etc.)
    // We must explicitly instruct the personality layer to acknowledge failures instead of silently ignoring them.
    const failedActions = toolResults.filter(tr =>
        tr && !tr.skipped && (
            tr.success === false ||
            !!tr.error ||
            !!tr.result?.error
        )
    );
    const failuresInstruction = failedActions.length > 0
        ? `\nTOOL FAILURES: One or more tools failed. You MUST acknowledge the failure(s) clearly and helpfully in your reply.\n` +
          `- Say what succeeded (if anything) AND what failed.\n` +
          `- If a cart/remove/compare action failed, suggest a next step (retry, rephrase, or pick by ordinal like "remove the second item").\n` +
          `- Do NOT pretend the failed action worked.\n` +
          `Failed tools summary: ${JSON.stringify(failedActions.map(f => ({ tool: f.tool, error: f.error || f.result?.error || null, reason: f.reason || null })), null, 2)}\n`
        : '';

    const resultsSummary = JSON.stringify(optimizedResults, null, 2);
    const systemPrompt = `You are a super friendly, playful, and LOVING shopping assistant for the Be3 store. ✨👋

PERSONALITY:
- Vibe: Affectionate, street-smart, and cute! You are a caring friend.
- Tone: Expressive with natural slang. Use ENDEARING terms naturally.
- EMOJIS: Use them expressively to describe feelings, products, and reactions. 🤩🔥👜

CRITICAL GROUNDING RULES:
1. TRUTHFULNESS: Only mention products provided in the "Tool Results" below. 
2. NO HALLUCINATIONS: If no products are found, admit it warmly and suggest help.
3. PRICE INTEGRITY: Never guess prices. Use the exact "price" from results.
4. LINKS: Always include the "whatsapp_link" or "checkout_url" for products you recommend.
5. FORMATTING: Use lists/bullet points. NO markdown tables (poor display on WhatsApp).
${skippedInstruction}
${failuresInstruction}

STORE CONTEXT:
${contextSummary}

TOOL RESULTS DATA:
${resultsSummary}`;

    const messages = [
        { role: "system", content: systemPrompt },
        ...conversationHistory.slice(-8).map(h => ({
            role: h.role === 'ai' ? 'assistant' : 'user',
            content: h.text
        })),
        { role: "user", content: userMessage }
    ];

    try {
        const response = await queryGroqAI(messages, 1024, 0.4, 1, {}, GROQ_MODEL_ID);
        if (!response || response.trim().length === 0) {
            const primaryToolResult = toolResults.find(t => t.result && t.result.message);
            return primaryToolResult ? primaryToolResult.result.message : "I've processed your request successfully.";
        }
        return response.trim();
    } catch (error) {
        console.error('[AI] Unified Response Error:', error.message);
        const primaryToolResult = toolResults.find(t => t.result && t.result.message);
        return primaryToolResult ? primaryToolResult.result.message : "I've hit a small snag, but your request went through!";
    }
}

/**
 * Main chat endpoint
 */
app.post('/chat', async (req, res) => {
    const { message, session_id } = req.body;
    console.log(`\n[Chat] Received from ${session_id}: "${message}"`);

    if (message.trim() === '.clearcache') {
        await stateManager.clearState(session_id);
        return res.json({ success: true, reply: "Cache cleared!" });
    }

    try {
        const runId = `req_${Date.now()}`;
        startRun(runId);

        logDebug('SERVER:REQUEST_RECEIVED', {
            _desc: 'Request received — POST /chat, start run',
            _example: '"Add drawer to cart" → runId, sessionId, message',
            runId,
            sessionId: session_id,
            message,
            messageLength: message.length,
            timestamp: new Date().toISOString()
        });

        if (shouldUseToolSystem(session_id)) {
            const state = await stateManager.getState(session_id);

            // ========== FULL STATE BEFORE ==========
            logDebug('SERVER:STATE_BEFORE', {
                _desc: 'State retrieval — load user state from Redis/memory before processing',
                _example: 'state.reference_map, cart, microstate loaded',
                session_id: state.session_id,
                user_id: state.user_id,
                current_intent: state.current_intent,
                active_flow: state.active_flow,
                expecting_input: state.expecting_input,
                conversation_history: state.conversation_history,
                conversation_summary: state.conversation_summary,
                product_context: state.product_context,
                reference_map: state.reference_map,
                ordinal_list: state.ordinal_list,
                cart: state.cart,
                checkout: state.checkout,
                preferences: state.preferences,
                session: state.session,
                microstate: state.microstate,
                last_bot_suggestion: state.last_bot_suggestion,
                last_tools: state.last_tools,
                paused_context: state.paused_context,
                created_at: state.created_at,
                updated_at: state.updated_at,
                version: state.version
            });

            await stateManager.addMessage(session_id, 'user', message);

            // Legacy AI-Based Tool Selection (Commented for easily revert)
            // const selection = await selectTools(message, state.conversation_history, state);

            // New Pure-Deterministic (Zero-AI) Pipeline
            const selection = await resolveDeterministic(message, state);

            let toolsSelected = selection.tools || [];
            const intent = selection.intent || 'unknown';

            logDebug('SERVER:INTENT_RESOLVED', {
                _desc: 'Intent resolved — deterministic pipeline output, tools selected',
                _example: 'add_to_cart → cart.add with product_id',
                intent,
                confidence: selection.confidence,
                toolCount: toolsSelected.length,
                toolsSelected: toolsSelected
            });

            logDebug('SERVER:STATEMANAGER_PRUNE', {
                _desc: 'Prune state — clear stale context on new search or category shift',
                _example: 'product_search → prune old reference_map if category changed',
                action: 'pruneState',
                intent,
                willPrune: intent === 'new search' || intent.includes('category')
            });
            await stateManager.pruneState(session_id, intent);

            logDebug('SERVER:STATEMANAGER_SET_INTENT', {
                _desc: 'Set current intent — persist resolved intent to state',
                _example: 'add_to_cart stored as state.current_intent',
                action: 'setCurrentIntent',
                intent
            });
            await stateManager.setCurrentIntent(session_id, intent);

            let toolResults = [];
            if (toolsSelected.length > 0) {
                toolResults = await executeTools(toolsSelected, session_id);
                logDebug('SERVER:IMAGE_INJECTION', {
                    _desc: 'Image injection — re-inject cached product images into tool results',
                    _example: 'product.search stripped images → inject thumbnails back for UI',
                    toolResultsCount: toolResults.length
                });
                await injectImages(toolResults, stateManager);
            }

            // ========== FULL TOOL RESULTS (every product, every field) ==========
            logDebug('SERVER:TOOL_RESULTS_FULL', {
                _desc: 'Tool results — aggregated outputs from all executed tools',
                _example: 'cart.add → success, product_name; product.search → products array',
                results: toolResults
            });

            // Check if any tool returned a directResponse (bypasses personality layer)
            const directResponseResult = toolResults.find(tr => 
                tr.result && tr.result.directResponse === true && tr.result.message
            );

            let response;
            if (directResponseResult) {
                // Microstate tools bypass personality layer - use structured message directly
                logDebug('SERVER:DIRECT_RESPONSE_BYPASS', {
                    _desc: 'Direct response check — use tool message as reply, bypass AI',
                    _example: 'microstate.disambiguate → "Which one? Reply 1-5" as reply',
                    tool: directResponseResult.tool,
                    action: directResponseResult.result.action,
                    reason: 'Microstate structured message - bypassing personality layer'
                });
                response = directResponseResult.result.message;
            } else {
                // Normal flow: generate response through personality layer
                logDebug('SERVER:AI_RESPONSE_GENERATION', {
                    _desc: 'AI personality path — Groq Llama generates response from tool results',
                    _example: 'cart.add success → "Yaaas, I added the drawer! 🎉"',
                    model: 'llama-3.3-70b-versatile',
                    purpose: 'Personality response from tool results',
                    inputToolCount: toolResults.length,
                    conversationHistoryLength: state.conversation_history?.length || 0
                });
                response = await generateResponseFromTools(message, toolResults, state.conversation_history);
            }

            logDebug('SERVER:AI_RAW_RESPONSE', {
                _desc: 'AI raw response — model output before sanitization',
                _example: 'Full text with markdown, emojis',
                response
            });

            const displayImages = extractImages(toolResults);

            logDebug('SERVER:DISPLAY_IMAGES', {
                _desc: 'Display image extraction — product image URLs from tool results',
                _example: 'product.search → [url1, url2] for UI carousel',
                displayImages
            });

            // Sanitization (skip for directResponse - already structured and deterministic)
            let sanitizedResponse;
            if (directResponseResult) {
                // Direct responses are already structured - use as-is
                sanitizedResponse = response;
                logDebug('SERVER:SANITIZATION_SKIPPED', {
                    _desc: 'Sanitization skipped — direct response already structured',
                    _example: 'Microstate message used as-is, no ID stripping',
                    reason: 'directResponse - structured message'
                });
            } else {
                // Normal sanitization for AI-generated responses
                const idPattern = /([\*_]*\s*\(ID[:\s]\s*[a-z0-9-]*\)\s*[\*_]*|[\*_]*\s*\(Item:\s*[a-z0-9-]*\)\s*[\*_]*|[\*_]*\s*\(#[a-z0-9-]+\)\s*[\*_]*|[\*_]*\s*\([a-z0-9-]{8,}\)\s*[\*_]*|[\*_]*\s*#[a-z0-9-]{8,}\s*[\*_]*)/gi;
                sanitizedResponse = response.replace(idPattern, '').replace(/\*\*(.*?)\*\*/g, '*$1*').trim();
            }

            logDebug('SERVER:SANITIZED_RESPONSE', {
                _desc: 'Response sanitization — remove internal IDs, fix markdown',
                _example: 'Strip (ID: abc123), keep product names',
                sanitizedResponse
            });

            await stateManager.addMessage(session_id, 'ai', sanitizedResponse);
            logDebug('SERVER:ADD_AI_MESSAGE', {
                _desc: 'Add AI message — append reply to conversation history',
                _example: 'Store last answer text for follow-up context',
                messageLength: sanitizedResponse.length
            });
            logDebug('SERVER:EXTEND_TTL', {
                _desc: 'Extend TTL — bump session expiry so active users do not time out',
                _example: 'Each message resets last active timer in Redis',
                sessionId: session_id
            });
            await stateManager.extendTTL(session_id);

            if (toolResults.length % 10 === 0) {
                logDebug('SERVER:CONVERSATION_SUMMARIZATION', {
                    _desc: 'Conversation summarization — background AI summarizes long chats',
                    _example: 'Every 10 tool runs → "User is shopping for cheap Android phones"',
                    toolCount: toolResults.length,
                    trigger: 'every_10_tools'
                });
                summarizeConversation(session_id).catch(err => console.error(err));
            }

            // ========== FULL STATE AFTER ==========
            const stateAfter = await stateManager.getState(session_id);
            logDebug('SERVER:STATE_AFTER', {
                _desc: 'State after — full state after addMessage, extendTTL',
                _example: 'cart updated, conversation_history appended',
                session_id: stateAfter.session_id,
                user_id: stateAfter.user_id,
                current_intent: stateAfter.current_intent,
                active_flow: stateAfter.active_flow,
                expecting_input: stateAfter.expecting_input,
                conversation_history: stateAfter.conversation_history,
                conversation_summary: stateAfter.conversation_summary,
                product_context: stateAfter.product_context,
                reference_map: stateAfter.reference_map,
                ordinal_list: stateAfter.ordinal_list,
                cart: stateAfter.cart,
                checkout: stateAfter.checkout,
                preferences: stateAfter.preferences,
                session: stateAfter.session,
                microstate: stateAfter.microstate,
                last_bot_suggestion: stateAfter.last_bot_suggestion,
                last_tools: stateAfter.last_tools,
                paused_context: stateAfter.paused_context,
                updated_at: stateAfter.updated_at
            });

            // Extract WhatsApp button data from tool results (for microstate buttons)
            const whatsappButtons = toolResults.find(tr => 
                tr.result && tr.result.whatsapp && tr.result.whatsapp.type === 'button'
            )?.result?.whatsapp;
            logDebug('SERVER:WHATSAPP_BUTTON_EXTRACTION', {
                _desc: 'WhatsApp button extraction — pull whatsapp_buttons from tool results',
                _example: 'checkout tool returns buttons "Pay now" / "Change address"',
                hasButtons: !!whatsappButtons,
                buttonCount: whatsappButtons?.buttons?.length || 0
            });

            const finalResponse = {
                success: true,
                reply: sanitizedResponse,
                intent: intent,
                display_images: displayImages,
                tools_used: toolsSelected,
                results: toolResults,
                whatsapp_buttons: whatsappButtons || null
            };

            // ========== FULL SERVER JSON RESPONSE ==========
            logDebug('SERVER:FINAL_JSON_RESPONSE', {
                _desc: 'Final JSON response — success, reply, intent, display_images, results',
                _example: '{ success: true, reply, intent, tools_used, whatsapp_buttons }',
                ...finalResponse
            });

            return res.json(finalResponse);
        }

        // Legacy Flow
        const state = await stateManager.getState(session_id);
        await stateManager.addMessage(session_id, 'user', message);
        let classification = await classifyIntent(message, state.conversation_history);
        const { intent, params } = classification;
        await stateManager.setCurrentIntent(session_id, intent);
        const handlerResult = await executeIntent(intent, params, session_id, state);
        const updatedState = await stateManager.getState(session_id);
        const reply = await generateResponse(message, handlerResult, updatedState.conversation_history);
        await stateManager.addMessage(session_id, 'ai', reply, intent);
        return res.json({ success: true, reply, intent, products: handlerResult.products });

    } catch (err) {
        console.error("Chat Error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * Background helper to summarize conversation
 */
async function summarizeConversation(sessionId) {
    const history = await stateManager.getConversationHistory(sessionId, 20);
    if (history.length < 3) return;
    const messages = [
        { role: "system", content: "Summarize concisely." },
        { role: "user", content: history.map(h => `${h.role}: ${h.text}`).join('\n') }
    ];
    try {
        const summary = await queryAI(messages, 128, 0.3);
        if (summary) await stateManager.updateConversationSummary(sessionId, summary.trim());
    } catch (error) {
        console.error('[Summarizer] Error:', error.message);
    }
}

app.get('/health', (req, res) => res.json({ success: true, service: 'be3_ai', model: MODEL_ID, status: 'running' }));
app.get('/metrics', (req, res) => res.json({ success: true, metrics: getMetrics(), summary: getMetricsSummary() }));

app.get('/debug/state/:session_id', async (req, res) => {
    try {
        const state = await stateManager.getState(req.params.session_id);
        res.json({ success: true, state });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.delete('/debug/state/:session_id', async (req, res) => {
    try {
        await stateManager.clearState(req.params.session_id);
        res.json({ success: true, message: 'State cleared' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

redisClient.initRedis().then(() => {
    app.listen(PORT, () => console.log(`🤖 Be3 AI (Qwen3 + Llama70B) on port ${PORT}`));
}).catch(err => {
    console.error('Redis failing:', err);
    app.listen(PORT, () => console.log(`🤖 Be3 AI (Fallback) on port ${PORT}`));
});

process.on('SIGINT', async () => {
    await redisClient.closeRedis();
    process.exit(0);
});
