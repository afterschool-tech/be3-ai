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

const { queryAI: queryGroqAI } = require('./hfAiService');
const SENTINEL_MODEL_ID = "llama-3.1-8b-instant";
const { logDebug } = require('../utils/debugLogger');

// Gate flag — set to true to always run, false to disable.
// Future: replace with confidence-based activation.
const ENABLE_SENTINEL = true;

const SENTINEL_PROMPT = `You are a product relevance evaluator for an eCommerce store. You will receive:
1. The user's query
2. A list of products returned by our search engine

Your ONLY job: determine if the search result contains items that genuinely match the intent of the query.

RELEVANCE RULES (MARK {"relevant": true}):
- BROAD MATCH: If the user asks for a category (e.g., "phone") and results contain that category, it is relevant.
- MODEL VARIATIONS: Minor variations in model numbers, sizes, or spec-suffixes ARE relevant. If the product is a functional match for the user's intent, it is relevant.
- SUBSIDIARIES: If they ask for a brand (e.g., "Samsung"), any product by that brand is relevant.
- PARTIAL ENTITY: If at least 1 or 2 items in the list correctly match the requested item type, it is relevant. 

IRRELEVANCE RULES (MARK {"relevant": false}):
- CATEGORY MISMATCH: User wants "gaming phones", results are ONLY "gaming chairs".
- ZERO MATCH: None of the words in the product names/categories share any meaning with the user's intent.
- NOISE: The list is generic placeholder data or completely different product types (e.g., user wants "wipes", results are "laptops").

VETTING RULE (ABSOLUTE):
- If the products returned already contain the correct BRAND and MODEL mentioned in the query, you MUST mark {"relevant": true}. 
- Do NOT suggest the exact same query as a vector_query. If you don't have a genuinely different/better search phrase to try, mark it as {"relevant": true}.

RESPONSE FORMAT:
- If products are relevant: {"relevant": true}
- If products are NOT relevant: {"relevant": false, "vector_query": "a smarter search phrase"}

IMPORTANT: Respond with ONLY valid JSON. No other text.`;

/**
 * Evaluate whether returned products are relevant to the user's query.
 * 
 * @param {string} userMessage - The user's original message
 * @param {Array} products - Array of product objects from product.search
 * @param {string} conversationSummary - Optional summary of the conversation history
 * @returns {Promise<{relevant: boolean, vector_query?: string}>}
 */
async function evaluateProductRelevance(userMessage, products, conversationSummary = null) {
    if (!ENABLE_SENTINEL) return { relevant: true };
    if (!Array.isArray(products) || products.length === 0) return { relevant: true };

    // Build a lean product summary for the sentinel (names + category hints only)
    const productSummary = products.slice(0, 8).map(p => ({
        name: p?.name || p?.title || 'unknown',
        description: typeof p?.description === 'string'
            ? (p.description.length > 80 ? p.description.substring(0, 80) + '...' : p.description)
            : null
    }));

    const userContext = conversationSummary
        ? `Conversation Summary: "${conversationSummary}"\n\nCurrent User message: "${userMessage}"`
        : `User message: "${userMessage}"`;

    const messages = [
        { role: 'system', content: SENTINEL_PROMPT },
        { role: 'user', content: `${userContext}\n\nProducts returned:\n${JSON.stringify(productSummary)}` }
    ];

    try {
        const response = await queryGroqAI(
            messages,
            60,         // max tokens — tiny response
            0.1,        // low temperature — deterministic
            1,          // single retry
            { response_format: { type: 'json_object' } },
            SENTINEL_MODEL_ID
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
