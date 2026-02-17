require('dotenv').config();
const { logDebug } = require('../utils/debugLogger');
const { OpenAI } = require("openai");

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const MODEL_ID = "llama-3.3-70b-versatile";
const FALLBACK_MODEL_ID = "llama-3.1-70b-versatile";

const client = new OpenAI({
    baseURL: "https://api.groq.com/openai/v1",
    apiKey: GROQ_API_KEY,
});

/**
 * Call Groq AI API via OpenAI SDK
 */
async function queryAI(messages, maxTokens = 512, temperature = 0.7, retries = 2, extraParams = {}, modelOverride = null) {
    let targetModel = modelOverride || MODEL_ID;

    for (let i = 0; i <= retries; i++) {
        try {
            console.log(`[AI] Querying Groq Model: ${targetModel} (Attempt ${i + 1}, maxTokens: ${maxTokens})...`);

            // DEBUG LOGGING: REQUEST
            logDebug(`AI REQUEST [${targetModel}] (Attempt ${i + 1})`, messages);

            const completion = await client.chat.completions.create({
                model: targetModel,
                messages: messages,
                max_tokens: maxTokens,
                temperature: temperature,
                ...extraParams
            });

            const content = completion.choices[0].message.content || "";

            // DEBUG LOGGING: RESPONSE
            console.log(`[AI] QueryAI Success: Got ${content.length} characters.`);
            logDebug(`AI RESPONSE [${targetModel}]`, content);

            return content;
        } catch (err) {
            const isRateLimit = err.status === 429 || err.message.toLowerCase().includes('rate limit');
            const isModelError = err.status === 400 || err.status === 404;

            // SELF-HEALING: If primary model is unavailable or misconfigured, try fallback immediately
            if (isModelError && targetModel === MODEL_ID) {
                console.warn(`[AI] Model ${targetModel} failed (${err.status}). Switching to Fallback: ${FALLBACK_MODEL_ID}`);
                targetModel = FALLBACK_MODEL_ID;
                i--; // Reset attempt for the new model
                continue;
            }

            if (i < retries && (isRateLimit || err.message.includes('timeout') || err.message.includes('socket'))) {
                const waitTime = Math.pow(2, i) * 1000;
                console.warn(`[AI] Error: ${err.message}. Retrying in ${waitTime}ms...`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
                continue;
            }

            console.error("AI API Error:", err.message);
            if (i === retries) throw new Error(`Failed to communicate with AI model: ${err.message}`);
        }
    }
}

module.exports = {
    queryAI,
    MODEL_ID,
    FALLBACK_MODEL_ID,
    client
};
