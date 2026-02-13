require('dotenv').config();
const express = require('express');
const { queryAI, MODEL_ID } = require('./aiService');
const { getIntentClassificationPrompt } = require('../legacy/intents');
const { executeIntent } = require('../legacy/handlers');
const { resolveClauses } = require('../utils/clauseResolver');
const { CATEGORIES, VENDORS, CATEGORY_INVENTORY, ATTRIBUTES, COLLECTIONS, getContextSummary } = require('../context/storeContext');
const stateManager = require('../state/stateManager');
const redisClient = require('../state/redis');
const cors = require('cors');
const { isConfirmation, isImplicitReference, extractSuggestion, checkSuggestionAcknowledgement } = require('../middleware/suggestionHelper');
const { detectConversationalIntent, isResumeRequest } = require('../middleware/conversationalDetector');
const { trackRequest, getMetrics, getMetricsSummary } = require('../utils/metrics');
const { FEATURES } = require('../middleware/featureFlags');
const fs = require('fs');

function logStep(msg) {
    const timestamp = new Date().toISOString();
    fs.appendFileSync('ai_steps.log', `[${timestamp}] ${msg}\n`);
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
        // Enriched context classification
        classificationPrompt = getIntentClassificationPrompt(CATEGORIES, VENDORS, ATTRIBUTES, COLLECTIONS);
    } else {
        // Legacy simplified classification
        const categories = Object.values(CATEGORIES).map(c => c.label);
        const vendors = Object.values(VENDORS).map(v => v.label);
        classificationPrompt = getIntentClassificationPrompt(categories, vendors);
    }

    // Build messages for classification (only last 3 for context to avoid distractions)
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

    // Parse JSON response
    try {
        // Try to extract JSON from response
        let jsonStr = response.trim();

        // If response has markdown code blocks, extract the JSON
        if (jsonStr.includes('```json')) {
            const match = jsonStr.match(/```json\s*([\s\S]*?)\s*```/);
            if (match) jsonStr = match[1];
        } else if (jsonStr.includes('```')) {
            const match = jsonStr.match(/```\s*([\s\S]*?)\s*```/);
            if (match) jsonStr = match[1];
        }

        // Find JSON object in the response (handle nested or multiple blocks)
        const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            jsonStr = jsonMatch[0];
        }

        // Clean any potential trailing characters or comments AI might have added
        jsonStr = jsonStr.substring(jsonStr.indexOf('{'), jsonStr.lastIndexOf('}') + 1);

        const classification = JSON.parse(jsonStr);

        return {
            intent: classification.intent || 'fallback_unknown',
            params: classification.params || {},
            confidence: classification.confidence !== undefined ? classification.confidence : 0.5
        };
    } catch (error) {
        console.error('[AI] Failed to parse classification:', error.message);
        console.error('[AI] Response received:', response);

        // Fallback to unknown intent
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
    // SPECIAL HANDLING FOR UNKNOWN INTENT - Last Chance at Conversation
    if (handlerResult.intent === 'fallback_unknown' || (handlerResult.confidence && handlerResult.confidence < 0.5)) {
        console.log(`[Unknown Recovery] Attempting to recover unknown intent with conversation context`);

        // Build context from recent conversation
        const contextualInfo = {
            conversation_history: conversationHistory.slice(-3).map(h => `${h.role}: ${h.text}`)
        };

        // Only attempt recovery if there's meaningful conversation history
        if (conversationHistory.length > 0) {
            const recoveryMessages = [
                {
                    role: "system",
                    content: `You are a helpful Be3 shopping assistant.

CRITICAL: The user's message was classified as "unknown", but it might relate to your recent conversation.

CONTEXT RECOVERY STRATEGY:
1. Check if the message relates to products you recently discussed
2. Check if it's a follow-up question about the last search
3. Check if it's a casual acknowledgment ("cool", "nice", "okay", "thanks")
4. If it relates to context, answer naturally
5. ONLY say "I'm not sure what you mean" if it's truly unrelated

IMPORTANT:
- Prioritize CONVERSATION over products.
- DO NOT invent or suggest products that are not in the context.
- If you don't know if a product exists, do NOT mention it.

Recent conversation:
${JSON.stringify(contextualInfo, null, 2)}

EXAMPLES OF RECOVERABLE "UNKNOWNS":
- "What about the battery?" → Relates to last product shown
- "That's cool" → Casual acknowledgment, respond warmly
- "How much?" → Asking about price of current product
- "Any other colors?" → Asking about product variations
- "Thanks" → Acknowledge appreciation

If you CAN relate this to the context, answer naturally.
If you CANNOT relate it to anything, then say: "I'm not sure what you mean. Can you rephrase that?"`
                },
                ...conversationHistory.slice(-5).map(h => ({
                    role: h.role === 'ai' ? 'assistant' : 'user',
                    content: h.text
                })),
                {
                    role: "user",
                    content: userMessage
                }
            ];

            try {
                const recoveryResponse = await queryAI(recoveryMessages, 256);

                // If the AI successfully recovered, return that response
                if (recoveryResponse &&
                    !recoveryResponse.toLowerCase().includes("not sure what you mean") &&
                    !recoveryResponse.toLowerCase().includes("don't understand")) {
                    console.log(`[Unknown Recovery] Successfully recovered unknown intent!`);
                    return recoveryResponse.trim();
                }

                // Otherwise, fall through to default unknown handling
                console.log(`[Unknown Recovery] Could not recover, using default unknown response`);
            } catch (error) {
                console.error('[Unknown Recovery] Recovery attempt failed:', error.message);
            }
        }
    }

    // If handler returned an error, format it nicely
    if (handlerResult.error) {
        return `I'm sorry, but ${handlerResult.error}`;
    }

    // If intent is fallback_unknown or greeting, allow full conversational freedom
    if ((handlerResult.intent === 'fallback_unknown' && !handlerResult.error) || handlerResult.intent === 'greeting') {
        const messages = [
            {
                role: "system",
                content: `You are a warm, friendly Be3 shopping assistant.
                
The user just sent a conversational message. Respond naturally and warmly!
You can:
- Chat casually and be personable
- Gently suggest products ONLY if clearly relevant
- Keep the conversation flowing

DON'T force a product search unless they explicitly ask. Be human-like and engaging. DO NOT invent products.`
            },
            ...conversationHistory.slice(-5).map(h => ({
                role: h.role === 'ai' ? 'assistant' : 'user',
                content: h.text
            })),
            { role: "user", content: userMessage }
        ];

        try {
            const response = await queryAI(messages, 512);
            if (response) return response.trim();
        } catch (e) {
            console.error('[AI] Conversational response failed:', e);
        }
    }

    // If handler already has a formatted message, use it
    if (handlerResult.message) {
        // If there's additional data, ask AI to format it nicely
        if (handlerResult.products || handlerResult.items || handlerResult.orders || handlerResult.product || handlerResult.recent_products || handlerResult.advice || handlerResult.help_menu || handlerResult.store_name || handlerResult.rotation_context) {

            let contextGrounding = "";
            if (FEATURES.contextIntegration) {
                const summary = getContextSummary();
                contextGrounding = `\nSTORE CONTEXT SUMMARY:\n${JSON.stringify(summary, null, 2)}\n`;
            }

            const dataContext = JSON.stringify(handlerResult, null, 2);

            const messages = [
                {
                    role: "system",
                    content: `You are a super friendly, playful, and CUTE shopping assistant for the Be3 store. ✨👋
                    
PERSONALITY:
- Vibe: Warm, relatable, and human. We're a small, passionate team!
- Tone: Be brief, catchy, and non-robotic. Use 1-2 emojis.
- Language: Keep it very simple and conversational.
${contextGrounding}
REASONING & STARTERS:
1. GREETINGS: Welcome them warmly! Use the "rotation_context" in the data to suggest ONE fun thing (either a category or a capability like "tracking orders"). Pick one at random so it feels fresh every time!
2. CAPABILITIES: If they ask what you can do, be very brief. Mention we find items, manage carts, and track orders with a cute "Be3" twist.

AVAILABILITY CHECKING:
- If a product isn't in the current "Data to present", check the "STORE CONTEXT SUMMARY" or "category_inventory" map before saying "we don't have it"
- If a likely category exists and has products (count > 0), suggest: "Let me search for that! We have items in that category."
- If the category doesn't exist or count = 0, say: "I don't see that in our inventory right now"
- NEVER say "we don't have X" definitively unless you've checked the inventory
- Use the hierarchical information to suggest relevant parent or child categories if a specific one is empty.

GROUNDING RULES:
- If "Data to present" has NO products (count=0), you MUST admit we don't have that specific item.
- DO NOT say "We have X in stock" if it is not in the data list or context summary.
- Feel free to discuss general product advice, but clearly state we don't carry that specific model if it's missing.
- For **Price**, **Stock**, and **Specs**, use ONLY provided data. NEVER invent a price.`
                },
                ...conversationHistory.slice(-10).map(h => ({
                    role: h.role === 'ai' ? 'assistant' : 'user',
                    content: h.text
                })),
                {
                    role: "user",
                    content: `User asked: "${userMessage}"\n\nData to present:\n${dataContext}\n\nProvide a consultative, friendly "Be3" response based on the data and your knowledge:`
                }
            ];

            try {
                const response = await queryAI(messages, 512);
                if (!response) return handlerResult.message;
                return response.trim();
            } catch (error) {
                console.error('[Stage 4] AI Generation failed:', error.message);
                return handlerResult.message;
            }
        }
        return handlerResult.message;
    }

    // Fallback: just stringify the result
    return JSON.stringify(handlerResult);
}

/**
 * Main chat endpoint - State-aware two-stage intent processing
 */
app.post('/chat', async (req, res) => {
    const { message, session_id, history = [] } = req.body;
    console.log(`\n[Chat] Received from ${session_id}: "${message}"`);

    try {
        const startTime = Date.now();

        // STAGE 0: Load/Initialize State
        console.log('[Stage 0] Loading state...');
        const state = await stateManager.getState(session_id);
        console.log(`[Stage 0] State loaded. Messages: ${state.session.message_count}, Active flow: ${state.active_flow?.type || 'none'}`);

        // Add user message to history
        await stateManager.addMessage(session_id, 'user', message);

        // STAGE 1: Classify Intent (with state context)
        console.log('[Stage 1] Classifying intent...');

        // 1. Check for RESUME request
        if (isResumeRequest(message)) {
            const resumed = await stateManager.resumeContext(session_id);
            if (resumed) {
                console.log(`[Server] Resuming context: ${resumed.type}`);
                // Restore context data to state (simplification: just putting it in product_context for now)
                if (resumed.type === 'search') {
                    state.product_context = state.product_context || {};
                    state.product_context.last_search = resumed.data;
                    // Re-trigger the search display logic or just acknowledge
                    return res.json({
                        success: true,
                        reply: "Resuming your search for " + (resumed.data.query || resumed.data.category),
                        products: resumed.data.results,
                        intent: 'search_products',
                        confidence: 1.0
                    });
                }
            }
        }

        let classification = await classifyIntent(message, state.conversation_history);

        // DETECT CONVERSATIONAL INTENT
        const conversationalAnalysis = await detectConversationalIntent(message, classification);
        console.log(`[Stage 1] Conversational analysis:`, conversationalAnalysis);

        // PAUSE CONTEXT IF SWITCHING TO CONVERSATION
        if (conversationalAnalysis.isPurelyConversational && state.product_context?.last_search?.results?.length > 0) {
            // If we have active search results and user switches to chat, pause the context
            await stateManager.pauseContext(session_id, 'search', state.product_context.last_search);
        }

        // CHECK FOR REFERENCE RESOLUTION (Bot Suggestion)
        const lastSuggestion = await stateManager.getLastSuggestion(session_id);

        // If user is dismissing or just chatting, clear suggestions and don't force context switch
        if (conversationalAnalysis.isDismissal) {
            console.log(`[Stage 1] User dismissed suggestion/offer. Clearing suggestions.`);
            await stateManager.clearLastSuggestion(session_id);
            // Override classification to greeting if it was misclassified
            if (classification.intent !== 'greeting' && classification.confidence < 0.8) {
                classification = {
                    intent: 'greeting',
                    params: {},
                    confidence: 0.85
                };
            }
        }
        // Only check suggestions if NOT purely conversational
        else if (lastSuggestion && lastSuggestion.intent && !conversationalAnalysis.isPurelyConversational) {
            console.log(`[Stage 1] Checking against last suggestion: ${lastSuggestion.text} (${lastSuggestion.intent})`);

            // 1. Check for explicit confirmation ("yes", "okay")
            const confirmation = isConfirmation(message);

            // 2. Check for implicit reference ("show me", "compare")
            const implicit = isImplicitReference(message, lastSuggestion);

            let accepted = false;

            if (confirmation === 'yes' || implicit) {
                accepted = true;
            } else if (confirmation !== 'no') {
                // 3. AI Check (Fallback for ambiguous cases)
                const ackStatus = await checkSuggestionAcknowledgement(message, lastSuggestion);
                console.log(`[Stage 1] AI Acknowledgement Status: ${ackStatus}`);

                if (ackStatus === 'accepted') {
                    accepted = true;
                } else if (ackStatus === 'ignored') {
                    // User changed topic -> Clear suggestion to avoid warping
                    console.log(`[Stage 1] User ignored suggestion. Clearing context.`);
                    await stateManager.clearLastSuggestion(session_id);
                }
            }

            if (accepted) {
                console.log(`[Stage 1] Suggestion ACCEPTED! Switching intent to: ${lastSuggestion.intent}`);
                classification = {
                    intent: lastSuggestion.intent,
                    params: lastSuggestion.params,
                    confidence: 0.95
                };
                await stateManager.clearLastSuggestion(session_id);
            }
        }
        // If purely conversational, prioritize greeting intent
        else if (conversationalAnalysis.isPurelyConversational && classification.confidence < 0.75) {
            console.log(`[Stage 1] Prioritizing conversational response over weak transactional intent`);
            classification = {
                intent: 'greeting',
                params: {},
                confidence: 0.80
            };
        }

        const { intent, params, confidence } = classification;
        console.log(`[Stage 1] Intent: ${intent} (confidence: ${confidence})`);
        console.log(`[Stage 1] Params:`, params);

        // Update current intent
        await stateManager.setCurrentIntent(session_id, intent);

        // STAGE 2: Semantic Resolution (Bridge Natural Language to Canonical Logic)
        let resolvedCategory = params.category || state.product_context?.last_search?.category;

        // Fallback: If category is missing but query matches a category name, use it
        if (!resolvedCategory && params.query) {
            const queryLower = params.query.toLowerCase();
            const foundCat = Object.values(CATEGORIES).find(c => c.label.toLowerCase() === queryLower || c.slug.toLowerCase() === queryLower);
            if (foundCat) {
                resolvedCategory = foundCat.label;
                console.log(`[Stage 2] Inferred category from query: "${resolvedCategory}"`);
            }
        }

        let resolvedContext = null;
        if (intent === 'search_products' && resolvedCategory) {
            console.log(`[Stage 2] Resolving clauses for category: "${resolvedCategory}"`);
            resolvedContext = await resolveClauses(message, resolvedCategory, state.conversation_history);
            if (resolvedContext.clauses.length > 0) {
                console.log(`[Stage 2] Success! Resolved clauses: ${resolvedContext.clauses.join(', ')}`);
                await stateManager.setMicrostate(session_id, 'clause_resolution', {
                    category: resolvedCategory,
                    clauses: resolvedContext.clauses,
                    display_words: resolvedContext.display_words
                });

                // CRITICAL: Refresh the state object so Stage 3 handler sees the new microstate
                const refreshedState = await stateManager.getState(session_id);
                Object.assign(state, refreshedState);
            }
        }

        // Propagate resolved category back to params for normalization in handlers
        if (resolvedCategory && !params.category) {
            params.category = resolvedCategory;
        }

        // STAGE 3: Execute Intent Handler (with refreshed state)
        console.log('[Stage 3] Executing handler...');

        // Enrich state with store context
        state.store_context = {
            categories: Object.values(CATEGORIES).map(c => ({ label: c.label, slug: c.slug })),
            vendors: Object.values(VENDORS).map(v => ({ name: v.business_name, tag: v.tag })),
            category_inventory: CATEGORY_INVENTORY
        };

        const handlerResult = await executeIntent(intent, params, session_id, state);
        console.log(`[Stage 3] Handler result:`, handlerResult);

        // Reload state after handler execution (handlers may have updated it)
        const updatedState = await stateManager.getState(session_id);

        // STAGE 4: Generate Natural Response (with updated state context)
        console.log('[Stage 4] Generating response...');
        const reply = await generateResponse(message, handlerResult, updatedState.conversation_history);
        console.log(`[Stage 4] Final reply: "${reply}"\n`);

        // TRACK BOT SUGGESTIONS (from reply or handler result)
        const newSuggestion = extractSuggestion(reply, handlerResult);
        if (newSuggestion) {
            console.log(`[Stage 4] Extracted suggestion: "${newSuggestion.text.substring(0, 50)}..." -> Intent: ${newSuggestion.intent}`);
            await stateManager.setLastSuggestion(session_id, newSuggestion);
        }

        // Auto-clear short-lived microstates
        const currentMicro = await stateManager.getMicrostate(session_id);
        if (currentMicro && (currentMicro.type === 'clause_resolution' || currentMicro.type === 'cart_interaction')) {
            await stateManager.clearMicrostate(session_id);
        }

        // Save AI response to history
        await stateManager.addMessage(session_id, 'ai', reply, classification.intent);

        // Extend session TTL
        await stateManager.extendTTL(session_id);

        // Track metrics (all requests currently go to legacy)
        const requestDuration = Date.now() - startTime;
        trackRequest('legacy', {
            apiCalls: 1, // Approximation for now
            responseTime: requestDuration,
            error: false
        });

        res.json({
            success: true,
            ...handlerResult, // Spread handler result (products, items, etc.)
            reply: reply,
            intent: classification.intent,
            confidence: classification.confidence
        });

    } catch (err) {
        console.error("Chat Error:", err);

        // Track error
        trackRequest('legacy', {
            apiCalls: 0,
            responseTime: 0,
            error: true
        });

        res.status(500).json({
            success: false,
            error: err.message,
            reply: "I'm having trouble processing your request right now. Please try again."
        });
    }
});

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
    res.json({
        success: true,
        service: 'be3_ai',
        model: MODEL_ID,
        status: 'running'
    });
});

/**
 * Metrics endpoint
 */
app.get('/metrics', (req, res) => {
    res.json({
        success: true,
        metrics: getMetrics(),
        summary: getMetricsSummary()
    });
});

/**
 * Debug endpoint to check state (for testing)
 */
app.get('/debug/state/:session_id', async (req, res) => {
    try {
        const { session_id } = req.params;
        const state = await stateManager.getState(session_id);
        res.json({ success: true, state });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Debug endpoint to clear state (for testing)
 */
app.delete('/debug/state/:session_id', async (req, res) => {
    try {
        const { session_id } = req.params;
        await stateManager.clearState(session_id);
        res.json({ success: true, message: 'State cleared' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});


// Initialize Redis on startup
redisClient.initRedis().then(() => {
    app.listen(PORT, () => {
        console.log(`\n🤖 Be3 AI Service (Qwen + State Management) running on port ${PORT}`);
        console.log(`📡 Backend API: ${process.env.BACKEND_API_URL || 'http://localhost:3000'}`);
        console.log(`🏢 Tenant ID: ${process.env.TENANT_ID || 'cbe1df05-45ed-455a-9ce6-156b0bd45713'}`);
        console.log(`💾 Redis: ${redisClient.isRedisConnected() ? 'Connected' : 'Fallback mode (in-memory)'}\n`);
    });
}).catch(err => {
    console.error('Failed to initialize Redis:', err);
    console.log('Starting in fallback mode (in-memory state only)\n');

    app.listen(PORT, () => {
        console.log(`\n🤖 Be3 AI Service (Qwen + State Management) running on port ${PORT}`);
        console.log(`⚠️  Running in FALLBACK mode (no Redis)\n`);
    });
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n\nShutting down gracefully...');
    await redisClient.closeRedis();
    process.exit(0);
});
