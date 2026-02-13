/**
 * Tool Selector
 * Uses the AI to select the optimal set of tools for a given user query.
 */

const { queryAI } = require('./aiService');
const { getToolDescriptions } = require('../tools/registry');
const { getContextSummary } = require('../context/storeContext');

/**
 * reliable JSON extraction from AI response
 */
function extractJSON(text) {
    if (!text) return null;
    try {
        const start = text.indexOf('[');
        const end = text.lastIndexOf(']');
        if (start !== -1 && end !== -1) {
            const jsonPart = text.substring(start, end + 1);
            return JSON.parse(jsonPart);
        }
    } catch (e) {
        console.error('[ToolSelector] JSON parse error:', e.message);
        console.error('[ToolSelector] Attempted to parse:', text.substring(text.indexOf('['), text.lastIndexOf(']') + 1));
    }
    return null;
}

/**
 * Select tools based on user message and context
 * @param {string} userMessage 
 * @param {Array} conversationHistory 
 * @returns {Promise<Array>} List of selected tools (or empty array)
 */
async function selectTools(userMessage, conversationHistory, lastSuggestion = null) {
    const toolDescriptions = getToolDescriptions();
    const contextSummary = JSON.stringify(getContextSummary()).substring(0, 4000); // Limit context size

    const suggestionContext = lastSuggestion ? `\nLAST BOT SUGGESTION (User might be responding to this):
${JSON.stringify(lastSuggestion, null, 2)}` : '';

    const systemPrompt = `You are the AI Orchestrator for the Be3 E-commerce Store.
Your goal is to select the BEST tools to fulfill the user's request efficiently.
${suggestionContext}

CORE PRINCIPLES:
1. DECISIVENESS: If the user asks for products or categories, use the appropriate tools immediately.
2. NO REDUNDANCY: Do NOT call metadata tools (category.getInfo, attribute.list) if you can perform a search directly.
3. SPECIFICITY: Use filters (category, attribute, vendor, price) in product.search whenever possible based on the request.
4. REUSE & REFERENCES: If the user refers to a product from the previous turn (e.g. "add it", "the first one"), use "the_first_one", "the_second_one", or the product name in "product_id". NEVER use placeholders like "ID of the product".
5. EXPLORATION: Use discovery.getTrending or discovery.getSuggestions if the user is just browsing or asks "what do you have?".
6. TARGETED VENDOR SEARCH: If the user mentions a specific product from a vendor (e.g. "their rattan drawers", "Samsung phone from Dareymi"), ALWAYS use "product.search" with the vendor's "tag" filter for precision. Only use "vendor.getProducts" for general inventory list requests like "What do they sell?".
7. HISTORY RESOLUTION: Resolve "their", "this vendor", or "that shop" using conversation history to find the correct vendor tag.
8. CONTACTING VENDORS: If the user wants to contact a vendor or get their WhatsApp link/number, use "vendor.getContactLink".
9. CONTEXT SWITCHING: If a user asks for a product that is logically unrelated to the previously discussed vendor (e.g. switching from furniture to electronics), DO NOT carry over the vendor "tag" unless explicitly requested.
10. VENDOR NEUTRALITY: By default, "product.search" should be vendor-agnostic (tag: null) unless the user specifies a shop or uses pronouns like "their", "that shop", etc.
 11. SENTINEL: Whenever you call "product.search" to find a specific item (including when following up on a recommendation like "the first one"), you MUST ALWAYS also append "discovery.ensureSuggestions" using the CURRENT search target (e.g. "Iphone XS Max") as the "search_intent" in the SAME selection. This tool ensures we never show irrelevant results without offering a high-quality alternative.
 12. RETRY: If the user says "Try again", "Retry", or "Repeat", re-select the tools you used in the previous turn.
 13. CONSOLIDATION: If you need to search for multiple variations (e.g. iPhone 12 and iPhone 13), use ONE "product.search" with a broader query. NEVER call the same search tool twice in one turn.
 14. STRICT OUTPUT: Return ONLY the JSON array. Do NOT explain your choices, do NOT say "Here are the tools", and do NOT provide a conversational response in this phase.

AVAILABLE TOOLS:
${JSON.stringify(toolDescriptions, null, 2)}

STORE CONTEXT (Category IDs, Slugs, Vendor Names):
${contextSummary}

OUTPUT FORMAT:
Return ONLY a valid JSON array of objects. No markdown, no pre-amble, no apologies. Failure to provide ONLY JSON will break the system.
Example:
[
  { "tool": "product.search", "params": { "query": "iPhone 12" }, "reason": "User search" },
  { "tool": "discovery.ensureSuggestions", "params": { "search_intent": "iPhone 12" }, "reason": "Sentinel" }
]`;

    const messages = [
        { role: 'system', content: systemPrompt },
        ...conversationHistory.slice(-4).map(h => ({
            role: h.role === 'ai' ? 'assistant' : 'user',
            content: h.text
        })),
        { role: 'user', content: userMessage }
    ];

    try {
        // Increased max tokens and slightly higher temperature for better reasoning
        const response = await queryAI(messages, 1024, 0.2);

        console.log(`[ToolSelector] Raw AI response: ${response}`);

        const selection = extractJSON(response);

        if (!Array.isArray(selection)) {
            console.warn('[ToolSelector] AI returned invalid format (not an array), defaulting to empty.');
            return [];
        }

        return selection;

    } catch (error) {
        console.error('[ToolSelector] Error selecting tools:', error);
        return [];
    }
}

module.exports = { selectTools };
