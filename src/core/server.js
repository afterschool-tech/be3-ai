require('dotenv').config();
const express = require('express');
const { queryAI, MODEL_ID, FALLBACK_MODEL_ID } = require('./aiService');
const { queryAI: queryGroqAI, MODEL_ID: GROQ_MODEL_ID } = require('./hfAiService');
const { getIntentClassificationPrompt } = require('../legacy/intents');
const { executeIntent } = require('../legacy/handlers');
const { resolveClauses } = require('../utils/clauseResolver');
const axios = require('axios');
const { CATEGORIES, VENDORS, CATEGORY_INVENTORY, ATTRIBUTES, COLLECTIONS, getContextSummary, getLeanContext, getUltraLeanContext } = require('../context/storeContext');
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
const stack = require('../services/intentResolver/pipeline/stack');
const { evaluateProductRelevance } = require('./productSentinel');
const { getMainSystemPrompt, getToolSystemPrompt, getLogicSystemPrompt, getPersonalityRewritePrompt } = require('./personalities');
const { logDebug, startRun } = require('../utils/debugLogger');
const fs = require('fs');

const BACKEND_URL = process.env.BACKEND_API_URL || 'http://localhost:3000';
const TENANT_ID = process.env.TENANT_ID || 'cbe1df05-45ed-455a-9ce6-156b0bd45713';

async function clearBackendCart(sessionId) {
    const headers = {
        'X-Tenant-ID': TENANT_ID,
        'Content-Type': 'application/json'
    };

    const cartRes = await axios({
        url: `${BACKEND_URL}/cart?session_id=${encodeURIComponent(sessionId)}`,
        method: 'GET',
        headers
    });

    const items = cartRes?.data?.items || [];
    let removed = 0;
    for (const item of items) {
        if (!item?.id) continue;
        await axios({
            url: `${BACKEND_URL}/cart/items/${item.id}`,
            method: 'DELETE',
            headers
        });
        removed++;
    }
    return { removed, hadItems: items.length };
}

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
 * Shared module — used by both server.js and the REPL.
 */
const { generateResponseFromTools } = require('./personalityLayer');

/**
 * Main chat endpoint
 */
app.post('/chat', async (req, res) => {
    const { message, session_id } = req.body;
    console.log(`\n[Chat] Received from ${session_id}: "${message}"`);

    const systemCmd = (message || '').trim().toLowerCase();
    if (systemCmd === '.clearcache' || systemCmd === '.clearcahe') {
        await stateManager.clearState(session_id);
        await stateManager.setLastTools(session_id, []);
        return res.json({ success: true, reply: "State cache cleared!" });
    }
    if (systemCmd === '.clearcart') {
        const { removed } = await clearBackendCart(session_id);
        return res.json({ success: true, reply: `Cart cleared! Removed ${removed} item${removed === 1 ? '' : 's'}.` });
    }
    if (systemCmd === '.clearall') {
        await stateManager.clearState(session_id);
        await stateManager.setLastTools(session_id, []);
        const { removed } = await clearBackendCart(session_id);
        return res.json({ success: true, reply: `State + cart cleared! Removed ${removed} item${removed === 1 ? '' : 's'} from cart.` });
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
            const previousToolHistory = await stateManager.getLastTools(session_id);

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

            // --- CONTEXTUAL CHECKOUT INJECTION ---
            // If the user wants to checkout but their cart is empty, check if they are actively viewing a product.
            const isCheckoutIntent = intent === 'start_checkout' || toolsSelected.some(t => t.tool === 'cart.checkout' || t.tool === 'start_checkout');
            const isCartEmpty = !state.cart || !Array.isArray(state.cart.items) || state.cart.items.length === 0;
            const currentlyViewing = state.product_context?.currently_viewing;

            if (isCheckoutIntent && isCartEmpty && currentlyViewing) {
                console.log(`[Server] 🛒 Empty cart checkout recovery: preemptively adding viewed product ${currentlyViewing} to cart.`);
                
                // Prepend an add_to_cart tool so the pipeline runs cart.add THEN cart.checkout
                toolsSelected.unshift({
                    tool: 'cart.add',
                    params: { product_id: currentlyViewing, quantity: 1 },
                    reason: 'Contextual checkout recovery (cart was empty but user is viewing a product)'
                });
            }

            logDebug('SERVER:INTENT_RESOLVED', {
                _desc: 'Intent resolved — deterministic pipeline output, tools selected',
                _example: 'add_to_cart → cart.add with product_id',
                intent,
                confidence: selection.confidence,
                toolCount: toolsSelected.length,
                toolsSelected: toolsSelected
            });

            // Pipeline confidence moved to index.js to support multi-intent statements natively

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

                // STACK-SCOPED SEARCH CONTEXT: if product.search ran, snapshot search_context into the stack
                const ranProductSearch = toolResults.some(tr => tr && tr.tool === 'product.search' && tr.success);
                if (ranProductSearch) {
                    const sCtx = await stateManager.getSearchContext(session_id);
                    const s = await stateManager.getStack(session_id);
                    if (s && sCtx && Array.isArray(sCtx.product_ids) && sCtx.product_ids.length > 0) {
                        s.last_search_context = sCtx;
                        if (!Array.isArray(s.search_history)) s.search_history = [];
                        s.search_history.push({
                            ts: new Date().toISOString(),
                            intent: 'product_search',
                            product_ids_count: sCtx.product_ids.length,
                            query: sCtx.query || '',
                            category_id: sCtx.category_id || null,
                            category: sCtx.category || null
                        });
                        await stateManager.setStack(session_id, s);
                    }
                }
            }

            // We'll consolidate tool history AFTER stack continuation runs.
            // (Stack execution mutates toolResults by pushing additional tool executions.)
            let consolidatedToolResults = [];

            // ═══════════════════════════════════════════════
            // STACK: Execute all remaining intents sequentially
            // ═══════════════════════════════════════════════
            // If ANY microstate is active, do not continue the stack in the same request.
            // This prevents overwriting the active microstate when the next stack intent
            // also requires a microstate.
            const activeMicrostateBeforeStack = await stateManager.getMicrostate(session_id);
            let stackData = await stateManager.getStack(session_id);
            let pausedForMicrostate = false;
            if (activeMicrostateBeforeStack) {
                console.log(`[Server] 🔒 Microstate already active (${activeMicrostateBeforeStack.type}) - skipping stack continuation`);
            } else if (stackData?.remaining_intents?.length > 0) {
                console.log(`[Server] 📚 Executing ${stackData.remaining_intents.length} remaining stack intents`);

                while (stackData && stackData.remaining_intents && stackData.remaining_intents.length > 0) {
                    const activeMicrostateInLoop = await stateManager.getMicrostate(session_id);
                    if (activeMicrostateInLoop) {
                        console.log(`[Server] 🔒 Microstate active (${activeMicrostateInLoop.type}) - pausing stack loop`);
                        pausedForMicrostate = true;
                        break;
                    }

                    // Re-resolve ordinals with fresh search_context before each intent
                    await stack.reResolveOrdinalsForRemainingIntents(
                        stackData.remaining_intents,
                        state,
                        { CATEGORIES, VENDORS, ATTRIBUTES }
                    );

                    const nextIntent = stackData.remaining_intents[0];

                    // Check if this intent needs a microstate (mirror REPL behavior)
                    const microstateRegistry = require('../services/intentResolver/config/microstateRegistry');
                    const triggered = microstateRegistry.checkTriggers(nextIntent.intentName, nextIntent.parameters || {}, []);
                    if (triggered) {
                        console.log(`[Server] 🔒 Microstate needed for: ${nextIntent.intentName} → ${triggered.triggerName}`);

                        const microstate = triggered.buildMicrostate(nextIntent);
                        await stateManager.setMicrostate(session_id, microstate);

                        // Keep intent at front of remaining_intents (do NOT advance)
                        await stateManager.setStack(session_id, stackData);

                        // Execute the microstate prompt tool (directResponse)
                        const promptTool = [{
                            tool: triggered.prompt.tool,
                            params: triggered.prompt.params,
                            reason: triggered.prompt.reason
                        }];
                        const promptResults = await executeTools(promptTool, session_id);
                        toolResults.push(...promptResults);

                        pausedForMicrostate = true;
                        break;
                    }

                    const nextTools = require('../services/intentResolver/pipeline/toolMapper').mapToTools([{
                        intentName: nextIntent.intentName,
                        parameters: nextIntent.parameters || {},
                        _ported_from: nextIntent._ported_from
                    }]);

                    console.log(`[Server] 📚 Executing stack intent: ${nextIntent.intentName}`);
                    const nextToolResults = await executeTools(nextTools, session_id);
                    toolResults.push(...nextToolResults);

                    // STACK-SCOPED SEARCH CONTEXT: if product.search ran in stack, snapshot search_context into stack
                    const ranStackProductSearch = nextToolResults.some(tr => tr && tr.tool === 'product.search' && tr.success);
                    if (ranStackProductSearch) {
                        const sCtx = await stateManager.getSearchContext(session_id);
                        if (sCtx && Array.isArray(sCtx.product_ids) && sCtx.product_ids.length > 0) {
                            if (!stackData.last_search_context) stackData.last_search_context = null;
                            stackData.last_search_context = sCtx;
                            if (!Array.isArray(stackData.search_history)) stackData.search_history = [];
                            stackData.search_history.push({
                                ts: new Date().toISOString(),
                                intent: nextIntent.intentName,
                                product_ids_count: sCtx.product_ids.length,
                                query: sCtx.query || '',
                                category_id: sCtx.category_id || null,
                                category: sCtx.category || null
                            });
                        }
                    }

                    // Update stack progress - ONLY advance if we actually executed
                    stackData.executed_intents.push(nextIntent);
                    stackData.remaining_intents = stackData.remaining_intents.slice(1);
                    stackData.current_intent_index++;

                    if (stackData.remaining_intents.length === 0) {
                        await stateManager.clearStack(session_id);
                        console.log(`[Server] 📚 Stack complete, cleared`);
                    } else {
                        await stateManager.setStack(session_id, stackData);
                    }

                    // Refresh stack data for next iteration
                    stackData = await stateManager.getStack(session_id);
                }
            }

            // ========== FULL TOOL RESULTS (every product, every field) ==========
            consolidatedToolResults = Array.isArray(previousToolHistory)
                ? [...previousToolHistory, ...toolResults]
                : [...toolResults];

            // IMAGE REINJECTION (stack-aware): re-inject images after stack continuation.
            // In stacked / multi-turn flows, product.search results may be from a prior turn (previousToolHistory)
            // or from later stack intents. Reinjection must happen on the consolidated results.
            logDebug('SERVER:IMAGE_INJECTION_STACK_AWARE', {
                _desc: 'Image injection — re-inject cached product images into consolidated tool results (stack-aware)',
                _example: 'product.search in earlier turn + stack continuation → consolidated results get images',
                toolResultsCount: consolidatedToolResults.length
            });
            await injectImages(consolidatedToolResults, stateManager);

            logDebug('SERVER:TOOL_RESULTS_FULL', {
                _desc: 'Tool results — aggregated outputs from all executed tools',
                _example: 'cart.add → success, product_name; product.search → products array',
                results: consolidatedToolResults
            });

            // Check if any tool returned a directResponse (bypasses personality layer).
            // IMPORTANT: Only consider tools executed in THIS request.
            // If we scan the consolidated history, an older microstate prompt can be
            // re-sent on a later turn, creating duplicate prompts on the frontend.
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
                // Collect all intent names for DCO (multi-intent / stacked intent support)
                const allIntentNames = [intent];
                const latestStack = await stateManager.getStack(session_id);
                if (latestStack?.executed_intents?.length > 0) {
                    for (const ei of latestStack.executed_intents) {
                        if (ei.intentName && !allIntentNames.includes(ei.intentName)) {
                            allIntentNames.push(ei.intentName);
                        }
                    }
                }

                // ═══════════════════════════════════════════════
                // PRODUCT SENTINEL — Pre-personality relevance gate
                // Evaluates whether returned products match the user's intent.
                // Bypassed for engineered UI tokens (e.g. __nav:more__, __filter__)
                // ═══════════════════════════════════════════════
                const ENABLE_SENTINEL = true;
                const isEngineeredMessage = message && message.trim().startsWith('__');

                const searchResultIndex = (!isEngineeredMessage && ENABLE_SENTINEL) ? consolidatedToolResults.findIndex(tr =>
                    tr && (tr.tool === 'product.search' || tr.tool === 'product_search') &&
                    tr.result && Array.isArray(tr.result.products) && tr.result.products.length > 0
                ) : -1;

                if (searchResultIndex >= 0) {
                    const searchResult = consolidatedToolResults[searchResultIndex];
                    const sentinelVerdict = await evaluateProductRelevance(message, searchResult.result.products);

                    if (!sentinelVerdict.relevant && sentinelVerdict.vector_query) {
                        logDebug('SERVER:SENTINEL_REJECTED', {
                            _desc: 'Sentinel rejected products as irrelevant — re-executing product.search with vector query',
                            _icon: '🔄',
                            vector_query: sentinelVerdict.vector_query,
                            rejected_product_count: searchResult.result.products.length,
                            rejected_products: searchResult.result.products.slice(0, 8).map(p => ({
                                name: p?.name || p?.title || 'unknown',
                                price: p?.price ?? null
                            }))
                        });

                        // Re-execute product.search through the tool pipeline (first-class results)
                        const sentinelTools = [{
                            tool: 'product.search',
                            params: {
                                query: sentinelVerdict.vector_query,
                                search_mode: 'VECTOR',
                                limit: 10
                            },
                            reason: `Sentinel re-search: original products rejected as irrelevant`
                        }];

                        const sentinelResults = await executeTools(sentinelTools, session_id);
                        await injectImages(sentinelResults, stateManager);

                        const newSearchResult = sentinelResults.find(tr =>
                            tr && tr.tool === 'product.search' && tr.result
                        );

                        if (newSearchResult && newSearchResult.result) {
                            // Move new products to suggested_products (prevents sentinel loop)
                            const final = newSearchResult.result;
                            const newProducts = final.products || [];
                            const originalWhatsappButtons = final.whatsapp?.buttons || [];
                            const snapshotId = Date.now().toString(36);
                            const seeMoreBtn = originalWhatsappButtons.find(b => b.id && b.id.startsWith('__nav:more')) || { id: `__nav:more:${snapshotId}__`, title: 'See more suggestions' };

                            newSearchResult.result = {
                                ...final,
                                products: [],
                                suggested_products: newProducts,
                                suggested_total: final.total || newProducts.length,
                                suggestion_message: "I couldn't find an exact match for your request. Here are some suggestions you might like instead.",
                                whatsapp_product_cards: undefined, // clear inline cards so UI uses suggestion flow
                                whatsapp: {
                                    type: 'button',
                                    buttons: [
                                        { id: '__nav:results__', title: 'See product details' },
                                        seeMoreBtn
                                    ].filter(Boolean)
                                }
                            };

                            logDebug('SERVER:SENTINEL_RESEARCH_COMPLETE', {
                                _desc: 'Sentinel re-search complete — new results placed in suggested_products (products=[])',
                                _icon: '📦',
                                vector_query: sentinelVerdict.vector_query,
                                suggested_product_count: newProducts.length,
                                suggested_products: newProducts.slice(0, 8).map(p => ({
                                    name: p?.name || p?.title || 'unknown',
                                    price: p?.price ?? null
                                }))
                            });

                            // Replace the old product.search result entirely
                            consolidatedToolResults.splice(searchResultIndex, 1, newSearchResult);

                            // Also update the toolResults array so buttons/cards extraction uses the new data
                            const oldToolIdx = toolResults.findIndex(tr =>
                                tr && (tr.tool === 'product.search' || tr.tool === 'product_search')
                            );
                            if (oldToolIdx >= 0) {
                                toolResults.splice(oldToolIdx, 1, newSearchResult);
                            } else {
                                toolResults.push(newSearchResult);
                            }
                        }
                    }
                }

                // Normal flow: generate response through personality layer (DCO-powered)
                logDebug('SERVER:AI_RESPONSE_GENERATION', {
                    _desc: 'AI personality path — DCO assembles intent-aware prompt, Groq generates response',
                    _example: 'product_search+add_to_cart → merged DCO segments → "Found it and added! 🎉"',
                    model: 'llama-3.3-70b-versatile',
                    purpose: 'DCO-powered personality response',
                    intentNames: allIntentNames,
                    inputToolCount: consolidatedToolResults.length,
                    conversationHistoryLength: state.conversation_history?.length || 0
                });
                response = await generateResponseFromTools(message, consolidatedToolResults, state.conversation_history, {
                    intentNames: allIntentNames.length === 1 ? allIntentNames[0] : allIntentNames,
                    conversationSummary: state.conversation_summary || null
                });
            }

            logDebug('SERVER:AI_RAW_RESPONSE', {
                _desc: 'AI raw response — model output before sanitization',
                _example: 'Full text with markdown, emojis',
                response
            });

            const displayImages = extractImages(consolidatedToolResults);

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

            // DCO: Trigger summarizer every 4 messages (not every 10 tools)
            const historyLen = state.conversation_history?.length || 0;
            if (historyLen > 0 && historyLen % 4 === 0) {
                logDebug('SERVER:CONVERSATION_SUMMARIZATION', {
                    _desc: 'Conversation summarization — shopping-journey-aware summary for DCO history compression',
                    _example: 'Every 4 messages → "User browsed phones, added Samsung A55, prefers mid-range"',
                    historyLength: historyLen,
                    trigger: 'every_4_messages'
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

            // Extract WhatsApp button data from tool results.
            // Only from THIS request (same reason as directResponseResult).
            // Aggregate multiple tool contributions into a single payload.
            // IMPORTANT: If the final reply is NOT a directResponse, ignore microstate tool buttons.
            // Otherwise, a microstate prompt's controls (More/Cancel/etc) can leak into an unrelated
            // final tool response (e.g., after compare fulfillment).
            const ignoreMicrostateButtons = !directResponseResult;
            const whatsappButtonResults = toolResults
                .filter(tr => {
                    if (!ignoreMicrostateButtons) return true;
                    const toolName = String(tr?.tool || '');
                    return !toolName.startsWith('microstate.');
                })
                .map(tr => tr?.result?.whatsapp)
                .filter(w => w && w.type === 'button');

            // Product cards may come either from legacy `result.whatsapp` (transaction=product_card)
            // or from explicit `result.whatsapp_product_cards` (preferred for tools like product.search).
            const whatsappProductCardResults = toolResults
                .map(tr => tr?.result?.whatsapp_product_cards)
                .filter(w => w && w.type === 'button' && w.transaction === 'product_card');

            const productCardPayload = whatsappProductCardResults.find(w =>
                Array.isArray(w?.cards) && w.cards.length > 0
            ) || whatsappButtonResults.find(w =>
                w?.transaction === 'product_card' && Array.isArray(w?.cards) && w.cards.length > 0
            ) || null;

            // Global button aggregation: ignore product_card payloads and merge the rest.
            let whatsappButtons = null;
            const globalButtonPayloads = whatsappButtonResults.filter(w => w?.transaction !== 'product_card');

            if (globalButtonPayloads.length > 0) {
                const merged = {
                    type: 'button',
                    buttons: []
                };

                // Priority-aware merge:
                // - Allow tools to contribute multiple buttons
                // - Choose top 3 by priority (desc)
                // - Stable tie-break by contribution order (tool order, then button order)
                // - De-dupe by id+title while keeping the highest priority version
                const candidates = [];
                let order = 0;
                for (const w of globalButtonPayloads) {
                    const payloadPriority = Number.isFinite(w?.priority) ? Number(w.priority) : 0;
                    const btns = Array.isArray(w.buttons) ? w.buttons : [];
                    for (const b of btns) {
                        const id = String(b?.id ?? '');
                        const title = String(b?.title ?? b?.text ?? id);
                        if (!id || !title) continue;
                        const priority = Number.isFinite(b?.priority) ? Number(b.priority) : payloadPriority;
                        candidates.push({ id, title, priority, order: order++ });
                    }

                    // Carry forward optional fields when present (first writer wins).
                    if (!merged.transaction && w.transaction) merged.transaction = w.transaction;
                    if (!merged.sponsor && w.sponsor) merged.sponsor = w.sponsor;
                }

                const bestByKey = new Map();
                for (const c of candidates) {
                    const key = `${c.id}::${c.title}`;
                    const existing = bestByKey.get(key);
                    if (!existing) {
                        bestByKey.set(key, c);
                        continue;
                    }
                    if (c.priority > existing.priority) {
                        bestByKey.set(key, c);
                        continue;
                    }
                    if (c.priority === existing.priority && c.order < existing.order) {
                        bestByKey.set(key, c);
                    }
                }

                const selected = Array.from(bestByKey.values())
                    .sort((a, b) => {
                        if (b.priority !== a.priority) return b.priority - a.priority;
                        return a.order - b.order;
                    })
                    .slice(0, 3)
                    .map(({ id, title }) => ({ id, title }));

                merged.buttons = selected;

                if (merged.buttons.length > 0) {
                    whatsappButtons = merged;
                }
            }

            logDebug('SERVER:WHATSAPP_BUTTON_EXTRACTION', {
                _desc: 'WhatsApp button extraction — aggregate whatsapp_buttons from tool results',
                _example: 'multiple tools each contribute a button; merged into one payload',
                buttonContributions: whatsappButtonResults.length,
                hasButtons: !!whatsappButtons,
                buttonCount: whatsappButtons?.buttons?.length || 0,
                hasProductCards: !!productCardPayload,
                productCardCount: productCardPayload?.cards?.length || 0
            });

            // Prevent stale tool UI payloads (buttons/cards/etc) from leaking via the `results` array.
            // Some clients render buttons directly off tool results (not just whatsapp_buttons).
            // We only want the UI elements from THIS turn's tools to be present in their respective results.
            const resultsForClient = Array.isArray(consolidatedToolResults)
                ? consolidatedToolResults.map(tr => {
                    // Check if this tool instance was newly executed in this request
                    const isNewInThisRequest = toolResults.some(newTr => newTr === tr);
                    if (!isNewInThisRequest && tr.result) {
                        const strippedResult = { ...tr.result };
                        delete strippedResult.whatsapp;
                        delete strippedResult.whatsapp_product_cards;
                        return { ...tr, result: strippedResult };
                    }
                    return tr;
                })
                : consolidatedToolResults;

            // --- LLM SUGGESTION EXTRACTION ---
            // If the AI response contains a <suggestion> XML block, parse and store it.
            // This replaces the old heuristic NLU pipeline simulation.
            let extractedSuggestion = null;
            const suggestionRegex = /<suggestion>([\s\S]*?)<\/suggestion>/i;
            const match = sanitizedResponse.match(suggestionRegex);
            
            if (match) {
                try {
                    const parsed = JSON.parse(match[1].trim());
                    if (parsed && parsed.is_suggestion && parsed.rephrase) {
                        extractedSuggestion = {
                            type: 'structured_payload',
                            hint: parsed.hint || 'general',
                            rephrase: parsed.rephrase
                        };
                        
                        await stateManager.updateState(session_id, { last_bot_suggestion: extractedSuggestion });
                        
                        // Strip the XML block from the final reply sent to the user so they don't see JSON
                        sanitizedResponse = sanitizedResponse.replace(suggestionRegex, '').trim();
                    }
                } catch (e) {
                    console.error('[SERVER] Failed to parse <suggestion> JSON block:', e.message);
                    // Still remove the problematic block so the user doesn't see broken JSON text
                    sanitizedResponse = sanitizedResponse.replace(suggestionRegex, '').trim();
                }
            }

            // Always log the result to telemetry for visibility
            if (extractedSuggestion) {
                logDebug('PIPELINE:SUGGESTION_AVAILABLE', {
                    _desc: 'The LLM provided a structured follow-up suggestion',
                    suggestion: extractedSuggestion,
                    _icon: '💡'
                });
            } else {
                logDebug('PIPELINE:NO_SUGGESTION', {
                    _desc: 'The LLM did not provide any follow-up suggestions in this response',
                    _icon: '🚫'
                });
            }

            const finalResponse = {
                success: true,
                reply: sanitizedResponse,
                intent: intent,
                display_images: displayImages,
                tools_used: toolsSelected,
                results: resultsForClient,
                whatsapp_buttons: whatsappButtons || null,
                whatsapp_product_cards: productCardPayload
            };

            // Persist tool history while multi-turn flows are active; clear when flow ends.
            const endMicrostate = await stateManager.getMicrostate(session_id);
            const endStack = await stateManager.getStack(session_id);
            const hasStack = !!(endStack && endStack.remaining_intents && endStack.remaining_intents.length > 0);
            const hasMicrostate = !!endMicrostate;
            if (hasStack || hasMicrostate) {
                const capped = consolidatedToolResults.slice(-50);
                await stateManager.setLastTools(session_id, capped);
            } else {
                await stateManager.setLastTools(session_id, []);
            }

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

    const SUMMARIZER_PROMPT = `You are summarizing a shopping conversation for an AI assistant's memory.
Capture ONLY:
- Products discussed (names, not IDs)
- Categories browsed
- Cart actions (added/removed what)
- User preferences (budget, color, brand, size)
- Current shopping stage (just browsing / comparing / ready to buy)
Keep it under 80 words. No fluff. No greetings. Facts only.`;

    const messages = [
        { role: "system", content: SUMMARIZER_PROMPT },
        { role: "user", content: history.map(h => `${h.role}: ${h.text}`).join('\n') }
    ];
    try {
        const summary = await queryAI(messages, 150, 0.3);
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
