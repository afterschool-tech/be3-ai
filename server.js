require('dotenv').config();
const express = require('express');
const { OpenAI } = require("openai");
const { getIntentClassificationPrompt } = require('./intents');
const { executeIntent } = require('./handlers');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 3005;
const HF_TOKEN = process.env.HUGGINGFACE_TOKEN;
const MODEL_ID = "Qwen/Qwen2.5-Coder-32B-Instruct";

const client = new OpenAI({
    baseURL: "https://router.huggingface.co/v1",
    apiKey: HF_TOKEN,
});

/**
 * Call Hugging Face Inference API via OpenAI SDK
 */
async function queryAI(messages, maxTokens = 512) {
    try {
        console.log(`[AI] Sending request to Qwen...`);

        const completion = await client.chat.completions.create({
            model: MODEL_ID,
            messages: messages,
            max_tokens: maxTokens,
            temperature: 0.7,
        });

        return completion.choices[0].message.content || "";
    } catch (err) {
        console.error("AI API Error:", err.message);
        throw new Error("Failed to communicate with AI model.");
    }
}

/**
 * Stage 1: Classify user intent
 */
async function classifyIntent(userMessage, conversationHistory = []) {
    const classificationPrompt = getIntentClassificationPrompt();

    // Build messages for classification
    const messages = [
        { role: "system", content: classificationPrompt },
        ...conversationHistory.map(h => ({
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

        // Find JSON object in the response
        const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            jsonStr = jsonMatch[0];
        }

        const classification = JSON.parse(jsonStr);

        return {
            intent: classification.intent || 'fallback_unknown',
            params: classification.params || {},
            confidence: classification.confidence || 0.5
        };
    } catch (error) {
        console.error('[AI] Failed to parse classification:', error.message);
        console.error('[AI] Raw response:', response);

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
        if (handlerResult.products || handlerResult.items || handlerResult.orders || handlerResult.product) {
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
 * Main chat endpoint - Two-stage intent processing
 */
app.post('/chat', async (req, res) => {
    const { message, session_id, history = [] } = req.body;
    console.log(`\n[Chat] Received from ${session_id}: "${message}"`);

    try {
        // STAGE 1: Classify Intent
        console.log('[Stage 1] Classifying intent...');
        const classification = await classifyIntent(message, history);
        console.log(`[Stage 1] Intent: ${classification.intent} (confidence: ${classification.confidence})`);
        console.log(`[Stage 1] Params:`, classification.params);

        // STAGE 2: Execute Intent Handler
        console.log('[Stage 2] Executing handler...');
        const handlerResult = await executeIntent(
            classification.intent,
            classification.params,
            session_id
        );
        console.log(`[Stage 2] Handler result:`, handlerResult);

        // STAGE 3: Generate Natural Response
        console.log('[Stage 3] Generating response...');
        const reply = await generateResponse(message, handlerResult, history);
        console.log(`[Stage 3] Final reply: "${reply}"\n`);

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

app.listen(PORT, () => {
    console.log(`\n🤖 Be3 AI Service (Qwen + Intent System) running on port ${PORT}`);
    console.log(`📡 Backend API: ${process.env.BACKEND_API_URL || 'http://localhost:3000'}`);
    console.log(`🏢 Tenant ID: ${process.env.TENANT_ID || 'cbe1df05-45ed-455a-9ce6-156b0bd45713'}\n`);
});
