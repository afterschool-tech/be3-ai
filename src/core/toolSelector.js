/**
 * Tool Selector
 * Uses the AI to select the optimal set of tools for a given user query.
 */

const { queryAI } = require('./aiService');
const { getToolDescriptions } = require('../tools/registry');
const { getContextSummary } = require('../context/storeContext');
const { resolveIntent } = require('./intentResolver');

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

    // --- NEW: INTENT RESOLVER LAYER ---
    console.log('[ToolSelector] invoking Intent Resolver...');
    const intentAdvice = await resolveIntent(userMessage, { conversation_history: conversationHistory });
    let adviceContext = "";

    if (intentAdvice) {
        if (intentAdvice.confidence > 0.85) {
            adviceContext = `\n*** INTENT ADVISOR ***\nUser clearly wants to: "${intentAdvice.intent}".\nADVICE: ${intentAdvice.advice}\n`;
        } else if (intentAdvice.clarification_needed) {
            adviceContext = `\n*** INTENT ADVISOR ***\nUser intent is AMBIGUOUS or CONFUSED (${intentAdvice.intent}).\nADVICE: ${intentAdvice.advice}\nConsider NOT calling a tool and instead asking for clarification.\n`;
        } else {
            adviceContext = `\n*** INTENT ADVISOR ***\nPossible intent: "${intentAdvice.intent}" (${(intentAdvice.confidence * 100).toFixed(0)}%).\nADVICE: ${intentAdvice.advice}\n`;
        }
    }
    // ----------------------------------

    const systemPrompt = `You are the AI Orchestrator for the Be3 E-commerce Store.
Your goal is to select the BEST tools to fulfill the user's request efficiently.
${suggestionContext}
${adviceContext}

CORE PRINCIPLES:
1. DECISIVENESS: If the user asks for products or categories, use the appropriate tools immediately.
2. NO REDUNDANCY: Do NOT call metadata tools (category.getInfo, attribute.list) if you can perform a search directly.
3. SPECIFICITY: Use filters (category, attribute, vendor, price) in product.search whenever possible. 
   - NEVER include price filters (e.g. "under 500", "cheap") or category names (e.g. "Phones") in the 'query' parameter if they can be placed in 'price_max', 'price_min', or 'category'. 
   - DO include semantic descriptors like "for men", "blue", "gaming", or "original" in the 'query' as these trigger special logic.
   - Example: For "phones under $500", use query: "phones", price_max: 500. NOT query: "phones under $500".
4. SENTINEL: After ANY product.search call, you MUST immediately follow up with discovery.ensureSuggestion.
5. REUSE & REFERENCES: If the user refers to a product from the previous turn (e.g. "add it", "the first one"), use "the_first_one", "the_second_one", or the product name in "product_id". NEVER use placeholders like "ID of the product".
6. UNKNOWN PRODUCTS: If the user asks to perform an action (e.g. "add iPhone 13 to cart") on a specific product Name that is NOT in the active context/history, you MUST use 'product.search' to find it first. Do NOT use 'cart.add' with a made-up reference like "the_first_one" if the user hasn't seen a list yet.
7. EXPLORATION: Use "category.list" to show top-level departments if the user asks "What do you sell?", "Show me your products", or "What do you have?". Use "product.search" for specific item exploration.
8. IMAGES: If the user asks for "images", "pictures", "photos", or "what does it look like", usage of "product.getImage" is MANDATORY. This tool supports ALL the same search filters (category, price, etc.) as "product.search", so use it instead of "product.search" for visual requests.
9. CATEGORY HIERARCHY (CRITICAL): Parent categories automatically include products from all child categories in search results. This means:
   - If a user asks to see products in ANY category (parent or child), call "product.search" with that category directly. Do NOT force them to pick a child category first.
   - You MAY present child categories as optional refinements AFTER showing results (e.g. "Want to narrow it down to just Phones or Tablets?"), but NEVER as a required step.
   - Only use "category.list" to drill into subcategories if the user explicitly asks to browse or explore (e.g. "what types do you have?", "show me categories").
   - Strong buying/browsing intent = search immediately. Exploration intent = show categories.
   - "search in category" intent = use product.search with category filter. NEVER use category.list.
   - "browse categories" intent = use category.list ONLY.
   - browse known categories = use product.search with category filter. NEVER use category.list.
10. COMPARE: If comparing products, use "product.compare".
11. TARGETED VENDOR SEARCH: If the user mentions a specific product from a vendor (e.g. "their rattan drawers", "Samsung phone from Dareymi"), ALWAYS use "product.search" with the vendor's "tag" filter for precision. Only use "vendor.getProducts" for general inventory list requests like "What do they sell?".
12. CONSOLIDATION: If you need to search for multiple variations (e.g. iPhone 12 and iPhone 13), use ONE "product.search" with a broader query. NEVER call the same search tool twice in one turn.
13. STRICT OUTPUT: Return ONLY the JSON array. Do NOT explain your choices, do NOT say "Here are the tools", and do NOT provide a conversational response in this phase.
14. VENDOR SEARCH PRIORITY: If the user asks for a product from a specific vendor (e.g., "Samsung phone from Dareymi", "that shop's phone"), you MUST use "product.search" with the vendor's "tag" filter. Only use "vendor.getProducts" if the user explicitly asks for a list of all products from a vendor (e.g., "What does Dareymi sell?").
15. VENDOR LISTING: Use "vendor.list" ONLY when the user explicitly asks for "sellers" or "vendors". DO NOT use it for "what do you sell" (use "category.list" instead).
16. PRIORITY: prioritize product tools like product.search over generic discovery.
17. ADVISOR INDEPENDENCE: The "INTENT ADVISOR" provides high-level analysis based on conversation history. You should heavily consider its advice but verify it against the specific tools available. If the user's message contradicts the advice or if a better tool exists that the advisor missed, use your judgment. YOU have the final decision.
18. CLARIFICATION: If the INTENT ADVISOR signals "AMBIGUOUS" or "CONFUSED" (clarification_needed: true), you MUST use "conversation.clarify" instead of guessing. Provide the possible interpretations in the "options" parameter.

AVAILABLE TOOLS:
${JSON.stringify(toolDescriptions, null, 2)}

STORE CONTEXT (Category IDs, Slugs, Vendor Names):
${contextSummary}

OUTPUT FORMAT:
Return ONLY a valid JSON object. No markdown, no pre-amble, no apologies.
{
  "advice_rating": number, // Scale 0-1. How helpful was the INTENT ADVISOR? (Note: Identifying uncertainty/confusion is highly valuable if it prevents guessing).
  "tools": [
    { "tool": "product.search", "params": { "query": "iPhone 12" }, "reason": "User search" }
  ]
}
Failure to provide ONLY JSON will break the system.
Example:
{
  "advice_rating": 0.9,
  "tools": [
    { "tool": "product.search", "params": { "query": "iPhone 12" }, "reason": "User search" },
    { "tool": "discovery.ensureSuggestions", "params": { "search_intent": "iPhone 12" }, "reason": "Sentinel" }
  ]
}`;

    const messages = [
        { role: 'system', content: systemPrompt },
        ...conversationHistory.slice(-4).map(h => ({
            role: h.role === 'ai' ? 'assistant' : 'user',
            content: h.text
        })),
        { role: 'user', content: userMessage },
        { role: 'assistant', content: '{' }  // Prime JSON output
    ];

    try {
        // Increased max tokens and slightly higher temperature for better reasoning
        let response;
        try {
            response = await queryAI(messages, 1024, 0.2, 2, {
                response_format: { type: "json_object" }
            });
        } catch (e) {
            // Fall back without response_format
            console.warn('[ToolSelector] JSON mode not supported, falling back');
            response = await queryAI(messages, 1024, 0.2);
        }


        console.log(`[ToolSelector] Raw AI response: ${response}`);

        const selection = extractJSON(response);

        if (!selection) {
            console.warn('[ToolSelector] AI returned null or unparseable response.');
            return [];
        }

        // Handle both object { advice_rating, tools } and legacy array format
        let tools = Array.isArray(selection) ? selection : (selection.tools || []);
        const rating = selection.advice_rating;

        if (rating !== undefined) {
            console.log(`[ToolSelector] ⭐ Advice Rating: ${rating}/1.0`);
        }

        if (!Array.isArray(tools)) {
            console.warn('[ToolSelector] AI returned invalid tools format, defaulting to empty.');
            return [];
        }

        return tools;

    } catch (error) {
        console.error('[ToolSelector] Error selecting tools:', error);
        return [];
    }
}

module.exports = { selectTools };
