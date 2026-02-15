/**
 * Intent Resolver
 * 
 * An intermediate advisory layer that analyzes user intent BEFORE tool selection.
 * It provides high-confidence "advice" to the Tool Selector to improve accuracy and handle ambiguity.
 */

const { queryAI } = require('./aiService');

// Exhaustive Intent List for reference and prompt injection
const INTENTS = {
    SEARCH: [
        'new search',             // Fresh search (unrelated to previous)
        'refine search',          // Modification of current search (filters, keywords)
        'visual search',          // Explicit request for images
        'broaden search',         // Removing filters
        'find similar items',     // "More like this"
        'search specific vendor', // "Do you have this from Samsung?"
        'filter results',         // "Only red ones"
        'sort results',           // "Cheapest first"
        'browse categories',      // "Show categories", "What do you sell?"
        'select category',         // "Go to electronics"
        'search in category'  // "Show me phones", "I want laptops" - HAS specific category + buying intent
    ],
    PRODUCT: [
        'select product',         // "The first one", "Add it"
        'get product details',    // "Specs?", "More info"
        'compare products',       // "Compare these two"
        'check availability',     // "Is it in stock?"
        'read reviews'            // "Is it good?"
    ],
    CART: [
        'add to cart',            // "Buy it", "Add to cart"
        'remove from cart',       // "Remove it"
        'view cart',              // "Show cart"
        'modify cart',            // "Make it 2"
        'start checkout',         // "Checkout"
        'check order status'      // "Where is my order?"
    ],
    ACCOUNT: [
        'login',
        'register',
        'view order history',     // "My past orders"
        'contact support',        // "Talk to human"
        'view faq',               // "Shipping policy?"
        'return item'
    ],
    NAVIGATION: [
        'go back',
        'go home',
        'negative feedback',      // "No not that"
        'positive feedback',      // "Perfect"
        'get help',
        'greeting',
        'retry conversation',     // "Send it again", "Show me again", "Repeat"
        'continue conversation',  // Casual chat
        'end conversation'
    ]
};

/**
 * Resolve user intent based on message and state
 * @param {string} userMessage 
 * @param {object} state (conversation_history, product_context, etc)
 */
async function resolveIntent(userMessage, state) {
    const contextSummary = {
        last_search: state.product_context?.last_search ? {
            query: state.product_context.last_search.query,
            category: state.product_context.last_search.category,
            result_count: state.product_context.last_search.result_count
        } : null,
        currently_viewing: state.product_context?.currently_viewing,
        cart_item_count: state.cart?.item_count || 0
    };

    const systemPrompt = `You are the Intent Resolver for the Be3 Store.
Your job is to classify the user's message into one of the known intents to GUIDE the downstream system.

**AVAILABLE INTENTS**:
${JSON.stringify(INTENTS, null, 2)}

**CRITICAL INSTRUCTION**:
- You must return the **SPECIFIC INTENT** (e.g., "new search", "add to cart", "retry conversation").
- **NEVER** return the Group Name (e.g., "SEARCH", "PRODUCT") as the intent.
- If the user asks to "send it again", use "retry conversation".

**EXAMPLES**:
- "Show me iphones" -> "new search"
- "Cheaper ones" -> "refine search"
- "Send it again" -> "retry conversation"
- "Add to cart" -> "add to cart"
- "Do you have Samsung?" -> "search specific vendor"
- "Hello" -> "greeting"
- "Show me phones" -> "search in category"
- "I want to browse laptops" -> "search in category"  
- "What categories do you have?" -> "browse categories"
- "What do you sell?" -> "browse categories"

**AMBIGUITY HANDLING**:
- If the user is vague (e.g., "order"), identify if it could mean 'add to cart' or 'view order history'.
- If the user is completely unclear, classify as 'unknown'.

** OUTPUT FORMAT**:
Return a JSON object:
{
  "intent": "string", // Best matching intent from list
  "confidence": number, // 0.0 to 1.0
  "reason": "string", // Brief explanation
  "alternate_intents": ["string"], // Other possibilities if ambiguous
  "clarification_needed": boolean, // True if confidence < 0.6 or ambiguous
  "advice": "string" // Instruction for the Tool Selector
}

**ADVICE GUIDELINES**:
- If definitive (>0.85): "Proceed with [Intent]. [Specific Detail]"
- If ambiguous (Split): "Ask user to clarify between [Option A] and [Option B]."
- If confused (<0.6): "Ask user to rephrase or clarify because [Reason]."
`;

    const messages = [
        { role: 'system', content: systemPrompt },
        ...state.conversation_history.slice(-3).map(h => ({
            role: h.role === 'ai' ? 'assistant' : 'user',
            content: h.text
        })),
        { role: 'user', content: `Context: ${JSON.stringify(contextSummary)}\n\nMessage: "${userMessage}"` }
    ];

    try {
        const response = await queryAI(messages, 256, 0.1); // Low temp for logic
        const jsonMatch = response.match(/\{[\s\S]*\}/);

        if (!jsonMatch) {
            console.warn('[IntentResolver] Could not parse JSON from AI response.');
            return null;
        }

        const result = JSON.parse(jsonMatch[0]);

        // Logging for visibility
        console.log(`[IntentResolver] 🧠 Analyzed: "${userMessage}"`);
        console.log(`[IntentResolver] -> Intent: ${result.intent} (${(result.confidence * 100).toFixed(0)}%)`);
        console.log(`[IntentResolver] -> Granularity: ${result.intent.includes('.') ? result.intent : 'General'}`);
        console.log(`[IntentResolver] -> Reasoning: ${result.reason}`);
        console.log(`[IntentResolver] -> Advice: ${result.advice}`);

        return result;

    } catch (error) {
        console.error('[IntentResolver] Error:', error.message);
        return null;
    }
}

module.exports = { resolveIntent };
