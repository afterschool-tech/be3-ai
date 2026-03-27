/**
 * Product Sentinel Layer
 * 
 * A lightweight LLM gate that evaluates whether returned products
 * are relevant to the user's query BEFORE the personality layer runs.
 * 
 * If all products are irrelevant, the sentinel returns a vector_query
 * for a smarter re-search. This runs as a separate, cheap LLM call
 * (~50 tokens response, JSON mode, low temperature).
 * 
 * ACTIVATION:
 *   Currently gated by ENABLE_SENTINEL flag (hardcoded true).
 *   Future: will be driven by pipeline confidence scoring
 *   (fallback count, semantic scores, entity detection confidence).
 */

const { queryAI: queryGroqAI, MODEL_ID: GROQ_MODEL_ID } = require('./hfAiService');
const { logDebug } = require('../utils/debugLogger');

// Gate flag — set to true to always run, false to disable.
// Future: replace with confidence-based activation.
const ENABLE_SENTINEL = true;

const SENTINEL_PROMPT = `You are a product relevance evaluator. You will receive:
1. The user's message
2. A list of products returned by search

Your ONLY job: decide if the products are relevant to what the user is asking for.

Rules:
- If NONE of the products match the TYPE the user wants, respond: {"relevant": false, "vector_query": "<better search phrase>"}
- If at least SOME products match what the user wants, respond: {"relevant": true}
- Example: User says "gaming phones", products are gaming chairs/headsets → {"relevant": false, "vector_query": "gaming smartphones"}
- Example: User says "headphones", products include headphones → {"relevant": true}

Respond with ONLY valid JSON. No other text.`;

/**
 * Evaluate whether returned products are relevant to the user's query.
 * 
 * @param {string} userMessage - The user's original message
 * @param {Array} products - Array of product objects from product.search
 * @returns {Promise<{relevant: boolean, vector_query?: string}>}
 */
async function evaluateProductRelevance(userMessage, products) {
    if (!ENABLE_SENTINEL) return { relevant: true };
    if (!Array.isArray(products) || products.length === 0) return { relevant: true };

    // Build a lean product summary for the sentinel (names + category hints only)
    const productSummary = products.slice(0, 8).map(p => ({
        name: p?.name || p?.title || 'unknown',
        description: typeof p?.description === 'string'
            ? (p.description.length > 80 ? p.description.substring(0, 80) + '...' : p.description)
            : null
    }));

    const messages = [
        { role: 'system', content: SENTINEL_PROMPT },
        { role: 'user', content: `User message: "${userMessage}"\n\nProducts returned:\n${JSON.stringify(productSummary)}` }
    ];

    try {
        const response = await queryGroqAI(
            messages,
            60,         // max tokens — tiny response
            0.1,        // low temperature — deterministic
            1,          // single retry
            { response_format: { type: 'json_object' } },
            GROQ_MODEL_ID
        );

        const parsed = JSON.parse(response.trim());

        logDebug('SENTINEL:EVALUATION_COMPLETE', {
            _desc: parsed.relevant
                ? 'Products passed relevance check — proceeding normally'
                : `Products REJECTED — LLM suggested vector_query: "${parsed.vector_query}"`,
            _icon: parsed.relevant ? '✅' : '🔄',
            relevant: parsed.relevant,
            vector_query: parsed.vector_query || null,
            evaluated_products: productSummary.map(p => p.name),
            user_message: userMessage
        });

        return {
            relevant: !!parsed.relevant,
            vector_query: parsed.vector_query || null
        };
    } catch (err) {
        logDebug('SENTINEL:EVALUATION_ERROR', {
            _desc: 'Sentinel evaluation failed — defaulting to relevant (safe fallback)',
            _icon: '⚠️',
            error: err.message
        });
        // On error, assume relevant to avoid blocking the pipeline
        return { relevant: true };
    }
}

module.exports = {
    evaluateProductRelevance,
    ENABLE_SENTINEL
};
