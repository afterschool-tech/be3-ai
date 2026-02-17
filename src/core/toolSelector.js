/**
 * Tool Selector
 * Uses the AI to select the optimal set of tools for a given user query.
 */

const { queryAI, FALLBACK_MODEL_ID } = require('./aiService');
const { logDebug } = require('../utils/debugLogger');
const { getToolDescriptions } = require('../tools/registry');
const { getLeanContext } = require('../context/storeContext');

/**
 * reliable JSON extraction from AI response
 */
function extractJSON(text) {
    if (!text) return null;
    try {
        // Find the first and last curly or square brace
        const start = text.search(/\{|\[/);
        const end = text.lastIndexOf(text[start] === '{' ? '}' : ']');
        if (start !== -1 && end !== -1) {
            const jsonPart = text.substring(start, end + 1);
            return JSON.parse(jsonPart);
        }
    } catch (e) {
        console.error('[ToolSelector] JSON parse error:', e.message);
        console.error('[ToolSelector] Attempted to parse:', text.substring(text.search(/\{|\[/), text.lastIndexOf('}') + 1));
    }
    return null;
}

// Exhaustive Intent List for guidance
const INTENTS = {
    SEARCH: [
        'new search', 'refine search', 'visual search', 'broaden search',
        'find similar items', 'search specific vendor', 'filter results',
        'sort results', 'browse categories', 'select category', 'search in category'
    ],
    PRODUCT: [
        'select product', 'get product details', 'compare products', 'check availability', 'read reviews'
    ],
    CART: [
        'add to cart', 'remove from cart', 'view cart', 'modify cart', 'start checkout', 'check order status'
    ],
    ACCOUNT: [
        'login', 'register', 'view order history', 'contact support', 'view faq', 'return item'
    ],
    NAVIGATION: [
        'go back', 'go home', 'negative feedback', 'positive feedback', 'get help', 'greeting',
        'retry conversation', 'continue conversation', 'end conversation'
    ]
};

/**
 * Select tools based on user message and context
 * @param {string} userMessage 
 * @param {Array} conversationHistory 
 * @param {object} state (full state)
 * @returns {Promise<object>} { tools, intent, confidence }
 */
async function selectTools(userMessage, conversationHistory, state = {}, lastSuggestion = null) {
    const toolDescriptions = getToolDescriptions();
    const leanContext = getLeanContext();

    const suggestionContext = lastSuggestion ? `\nLAST BOT SUGGESTION: ${JSON.stringify(lastSuggestion)}` : '';

    const systemPrompt = `You are the AI Orchestrator for the Be3 E-commerce Store.
Your goal is to 1) Classify User Intent and 2) Select the BEST tools to fulfill the request.

AVAILABLE INTENTS:
${JSON.stringify(INTENTS, null, 2)}

CORE PRINCIPLES:
1. DECISIVENESS: Use search/cart tools immediately if intent is clear.
2. NO REDUNDANCY: Do NOT call metadata tools if a search can be performed.
3. SPECIFICITY: Use filters (category, price, vendor) in product.search.
4. SENTINEL: Always follow product.search with discovery.ensureSuggestions.
5. REUSE: Use "the_first_one", "it", or names for product references.
6. HIERARCHY: Search parents includes children. No need to browse first unless asked "what types?".
7. INTENT MAPPING: Choose the SPECIFIC intent from the list above. Never return a group like "SEARCH".
8. CLARIFICATION: if input is gibberish or totally ambiguous, use "conversation.clarify".

AVAILABLE TOOLS:
${JSON.stringify(toolDescriptions, null, 2)}

STORE CONTEXT (High-level):
${JSON.stringify(leanContext, null, 2)}

OUTPUT FORMAT:
Return ONLY a valid JSON object:
{
  "intent": "specific intent name",
  "confidence": number, // 0.0 - 1.0
  "reason": "brief reasoning",
  "tools": [
    { "tool": "product.search", "params": { "query": "iPhone" }, "reason": "search" },
    { "tool": "discovery.ensureSuggestions", "params": { "search_intent": "iPhone" }, "reason": "sentinel" }
  ]
}`;

    // Limit history to last 10 messages to keep prompt lean
    const historyLimit = 10;
    const historyToInclude = conversationHistory.slice(-historyLimit);

    const messages = [
        { role: 'system', content: systemPrompt },
        ...historyToInclude.map(h => ({
            role: h.role === 'ai' ? 'assistant' : 'user',
            content: h.text
        })),
        { role: 'user', content: userMessage },
        { role: 'assistant', content: '{' }  // Prime JSON output
    ];

    try {
        console.log(`[ToolSelector] Analyzing "${userMessage}" with ${historyToInclude.length} history items...`);

        let response;
        try {
            // Attempt 1: Standard Model (Llama 3.3-70B recommended in plan)
            response = await queryAI(messages, 1024, 0.2, 0, {
                response_format: { type: "json_object" }
            });
        } catch (e) {
            console.warn('[ToolSelector] Attempt 1 failed or JSON mode error.');
        }

        // Attempt 2: Fallback if empty or invalid
        if (!response || !extractJSON(response)) {
            console.log(`[ToolSelector] ⚠️ Retrying with fallback model ${FALLBACK_MODEL_ID}...`);
            response = await queryAI(messages, 1024, 0.4, 1, {}, FALLBACK_MODEL_ID);
        }

        const selection = extractJSON(response);

        if (!selection) {
            console.warn('[ToolSelector] AI returned null selection. Defaulting to navigation.');
            return { tools: [], intent: 'unknown', confidence: 0 };
        }

        // Map selection to final object
        const tools = selection.tools || (Array.isArray(selection) ? selection : []);
        const intent = selection.intent || 'unknown';
        const confidence = selection.confidence || 0.5;

        console.log(`[ToolSelector] -> Intent: ${intent} (${(confidence * 100).toFixed(0)}%)`);
        console.log(`[ToolSelector] -> Tools: ${tools.map(t => t.tool).join(', ') || 'NONE'}`);

        return {
            tools: Array.isArray(tools) ? tools : [],
            intent: intent,
            confidence: confidence,
            reason: selection.reason
        };

    } catch (error) {
        console.error('[ToolSelector] Fatal Error:', error);
        return { tools: [], intent: 'error', confidence: 0 };
    }
}

module.exports = { selectTools };
