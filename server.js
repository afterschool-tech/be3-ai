require('dotenv').config();
const express = require('express');
const { OpenAI } = require("openai");
const { getIntentClassificationPrompt } = require('./intents');
const { executeIntent } = require('./handlers');
const { resolveClauses } = require('./resolver');
const { CATEGORIES, VENDORS } = require('./storeContext');
const stateManager = require('./stateManager');
const redisClient = require('./redis');
const cors = require('cors');
const fs = require('fs');

function logStep(msg) {
    const timestamp = new Date().toISOString();
    fs.appendFileSync('ai_steps.log', `[${timestamp}] ${msg}\n`);
}

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 3005;
const HF_TOKEN = process.env.HUGGINGFACE_TOKEN;
const MODEL_ID = "meta-llama/Meta-Llama-3-8B-Instruct";

const client = new OpenAI({
    baseURL: "https://router.huggingface.co/v1",
    apiKey: HF_TOKEN,
});

/**
 * Call Hugging Face Inference API via OpenAI SDK
 */
async function queryAI(messages, maxTokens = 512, retries = 2) {
    for (let i = 0; i <= retries; i++) {
        try {
            console.log(`[AI] Sending request to Qwen (Attempt ${i + 1})...`);

            const completion = await client.chat.completions.create({
                model: MODEL_ID,
                messages: messages,
                max_tokens: maxTokens,
                temperature: 0.7,
            });

            return completion.choices[0].message.content || "";
        } catch (err) {
            const isRateLimit = err.message.toLowerCase().includes('rate limit') ||
                err.message.toLowerCase().includes('429') ||
                err.message.toLowerCase().includes('subscribe to pro');

            if (i < retries && (isRateLimit || err.message.includes('timeout') || err.message.includes('socket'))) {
                const waitTime = Math.pow(2, i) * 1000;
                console.warn(`[AI] Error: ${err.message}. Retrying in ${waitTime}ms...`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
                continue;
            }

            console.error("AI API Error:", err.message);
            throw new Error(`Failed to communicate with AI model: ${err.message}`);
        }
    }
}

/**
 * Stage 1: Classify user intent
 */
async function classifyIntent(userMessage, conversationHistory = []) {
    const categories = Object.values(CATEGORIES).map(c => c.label);
    const vendors = Object.values(VENDORS).map(v => v.business_name);

    const classificationPrompt = getIntentClassificationPrompt(categories, vendors);

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
    // If handler returned an error, format it nicely
    if (handlerResult.error) {
        return `I'm sorry, but ${handlerResult.error}`;
    }

    // If handler already has a formatted message, use it
    if (handlerResult.message) {
        // If there's additional data, ask AI to format it nicely
        if (handlerResult.products || handlerResult.items || handlerResult.orders || handlerResult.product || handlerResult.recent_products || handlerResult.advice) {
            const dataContext = JSON.stringify(handlerResult, null, 2);

            const messages = [
                {
                    role: "system",
                    content: `You are a friendly shopping assistant. Format the following data into a natural, conversational response. Be concise but helpful. Use emojis sparingly. If showing products, list them clearly with prices.`
                },
                ...conversationHistory.slice(-4).map(h => ({
                    role: h.role === 'ai' ? 'assistant' : 'user',
                    content: h.text
                })),
                {
                    role: "user",
                    content: `User asked: "${userMessage}"\n\nData to present:\n${dataContext}\n\nFormat this into a friendly response:`
                }
            ];

            try {
                const response = await queryAI(messages, 512);
                return response.trim();
            } catch (error) {
                console.error('[AI] Failed to generate response:', error.message);
                // Fallback to basic formatting
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
        // STAGE 0: Load/Initialize State
        console.log('[Stage 0] Loading state...');
        const state = await stateManager.getState(session_id);
        console.log(`[Stage 0] State loaded. Messages: ${state.session.message_count}, Active flow: ${state.active_flow?.type || 'none'}`);

        // Add user message to history
        await stateManager.addMessage(session_id, 'user', message);

        // STAGE 1: Classify Intent (with state context)
        console.log('[Stage 1] Classifying intent...');
        const classification = await classifyIntent(message, state.conversation_history);
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
        const handlerResult = await executeIntent(intent, params, session_id, state);
        console.log(`[Stage 3] Handler result:`, handlerResult);

        // Reload state after handler execution (handlers may have updated it)
        const updatedState = await stateManager.getState(session_id);

        // STAGE 4: Generate Natural Response (with updated state context)
        console.log('[Stage 4] Generating response...');
        const reply = await generateResponse(message, handlerResult, updatedState.conversation_history);
        console.log(`[Stage 4] Final reply: "${reply}"\n`);

        // Auto-clear short-lived microstates
        const currentMicro = await stateManager.getMicrostate(session_id);
        if (currentMicro && (currentMicro.type === 'clause_resolution' || currentMicro.type === 'cart_interaction')) {
            await stateManager.clearMicrostate(session_id);
        }

        // Save AI response to history
        await stateManager.addMessage(session_id, 'ai', reply, classification.intent);

        // Extend session TTL
        await stateManager.extendTTL(session_id);

        res.json({
            success: true,
            reply: reply,
            intent: classification.intent,
            confidence: classification.confidence
        });

    } catch (err) {
        console.error("Chat Error:", err);
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
