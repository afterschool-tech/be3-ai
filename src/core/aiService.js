require('dotenv').config();
const { logDebug } = require('../utils/debugLogger');
const { OpenAI } = require("openai");

const HF_TOKEN = process.env.HUGGINGFACE_TOKEN;
const MODEL_ID = "Qwen/Qwen3-Coder-Next";
const FALLBACK_MODEL_ID = "Qwen/Qwen2.5-72B-Instruct";

let client = null;

function getClient() {
    if (client) return client;
    if (!HF_TOKEN) {
        console.warn("[AI-HF] HUGGINGFACE_TOKEN is missing. AI features may fail.");
        return null;
    }
    client = new OpenAI({
        baseURL: "https://router.huggingface.co/v1",
        apiKey: HF_TOKEN,
    });
    return client;
}

/**
 * Call Hugging Face AI API via OpenAI SDK
 */
async function queryAI(messages, maxTokens = 512, temperature = 0.7, retries = 2, extraParams = {}, modelOverride = null) {
    let targetModel = modelOverride || MODEL_ID;

    for (let i = 0; i <= retries; i++) {
        try {
            console.log(`[AI-HF] Querying HF Router Model: ${targetModel} (Attempt ${i + 1}, maxTokens: ${maxTokens})...`);

            // DEBUG LOGGING: REQUEST
            logDebug(`HF REQUEST [${targetModel}] (Attempt ${i + 1})`, messages);

            const aiClient = getClient();
            if (!aiClient) throw new Error("AI Client not initialized (missing API key)");

            const completion = await aiClient.chat.completions.create({
                model: targetModel,
                messages: messages,
                max_tokens: maxTokens,
                temperature: temperature,
                ...extraParams
            });

            const content = completion.choices[0].message.content || "";

            // DEBUG LOGGING: RESPONSE
            console.log(`[AI-HF] QueryAI Success: Got ${content.length} characters.`);
            logDebug(`HF RESPONSE [${targetModel}]`, content);

            return content;
        } catch (err) {
            const isRateLimit = err.status === 429 || err.message.toLowerCase().includes('rate limit');
            const isModelError = err.status === 400 || err.status === 404;

            // SELF-HEALING: If primary model is unavailable or misconfigured, try fallback immediately
            if (isModelError && targetModel === MODEL_ID) {
                console.warn(`[AI-HF] Model ${targetModel} failed (${err.status}). Switching to Fallback: ${FALLBACK_MODEL_ID}`);
                targetModel = FALLBACK_MODEL_ID;
                i--; // Reset attempt for the new model
                continue;
            }

            if (i < retries && (isRateLimit || err.message.includes('timeout') || err.message.includes('socket'))) {
                const waitTime = Math.pow(2, i) * 1000;
                console.warn(`[AI-HF] Error: ${err.message}. Retrying in ${waitTime}ms...`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
                continue;
            }

            console.error("AI HF API Error:", err.message);
            if (i === retries) throw new Error(`Failed to communicate with HF AI model: ${err.message}`);
        }
    }
}

module.exports = {
    queryAI,
    MODEL_ID,
    FALLBACK_MODEL_ID
};
