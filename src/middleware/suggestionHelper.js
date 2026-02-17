/**
 * Suggestion Tracking Helper Functions
 * Used by server.js to track and resolve bot suggestions
 */

/**
 * Check if user message is a confirmation
 */
function isConfirmation(message) {
    const msg = message.toLowerCase().trim();
    const affirmative = ['yes', 'yeah', 'yep', 'sure', 'okay', 'ok', 'yea', 'yup', 'alright', 'fine', 'please'];
    const negative = ['no', 'nope', 'nah', 'not really', 'don\'t think so', 'dont think so'];

    if (affirmative.includes(msg)) return 'yes';
    if (negative.includes(msg)) return 'no';
    return null;
}

/**
 * Check if user message implicitly references a bot suggestion
 */
function isImplicitReference(message, lastSuggestion) {
    if (!lastSuggestion) return false;

    const msg = message.toLowerCase().trim();

    // Check for action words that match the suggested intent
    const actionWords = {
        'search_products': ['show', 'find', 'search', 'look for', 'get'],
        'compare_products': ['compare'],
        'view_product': ['tell me more', 'details', 'info'],
        'add_to_cart': ['add', 'buy', 'purchase']
    };

    const intentActions = actionWords[lastSuggestion.intent] || [];
    const hasActionWord = intentActions.some(action => msg.includes(action));

    // Also check if the message mentions the suggested product/category
    if (lastSuggestion.text) {
        const lowerText = lastSuggestion.text.toLowerCase();
        if (msg.includes(lowerText)) {
            return true;
        }
    }

    return hasActionWord;
}

/**
 * Extract suggestions from bot response and handler result
 */
function extractSuggestion(reply, handlerResult) {
    const lowerReply = reply.toLowerCase();

    // 1. Data-First Extraction: If handler has products, suggest the first one for details
    if (handlerResult.products && handlerResult.products.length > 0) {
        const p = handlerResult.products[0];
        // Only suggest if the bot actually mentioned it or it's a list
        return {
            type: 'product_offer',
            intent: 'view_product',
            params: { product_id: p.id },
            text: p.name || p.title
        };
    }

    // 2. Contextual Rotation Extraction
    if (handlerResult.rotation_context) {
        const { suggested_categories } = handlerResult.rotation_context;
        if (suggested_categories && suggested_categories.length > 0) {
            return {
                type: 'category_offer',
                intent: 'search_products',
                params: { category: suggested_categories[0] },
                text: suggested_categories[0]
            };
        }
    }

    // 3. RegEx Patterns (Fallback)
    const showPattern = /would you like me to show you (.*?)\?/i;
    const showMatch = reply.match(showPattern);
    if (showMatch) {
        return {
            type: 'product_offer',
            intent: 'search_products',
            params: { query: showMatch[1].trim() },
            text: showMatch[1].trim()
        };
    }

    const comparePattern = /i can help you compare (.*?)[\.\?]/i;
    const compareMatch = reply.match(comparePattern);
    if (compareMatch) {
        return {
            type: 'action_offer',
            intent: 'compare_products',
            params: { category: compareMatch[1].trim() },
            text: compareMatch[1].trim()
        };
    }

    const searchPattern = /let me (?:search for|find) (.*?)[\.\?]/i;
    const searchMatch = reply.match(searchPattern);
    if (searchMatch) {
        return {
            type: 'action_offer',
            intent: 'search_products',
            params: { query: searchMatch[1].trim() },
            text: searchMatch[1].trim()
        };
    }

    return null;
}


const { queryAI } = require('../core/aiService');

/**
 * AI-Powered check for suggestion acknowledgement
 * Returns 'accepted', 'rejected', or 'ignored'
 */
async function checkSuggestionAcknowledgement(message, lastSuggestion) {
    if (!lastSuggestion || !message) return 'ignored';

    try {
        const prompt = [
            {
                role: "system",
                content: `You are a conversation analyst.
                Bot recently suggested: "${lastSuggestion.text || 'something'}" (Intent: ${lastSuggestion.intent})
                User replied: "${message}"

                Determine the user's reaction:
                - ACCEPTED: User accepts, asks for details, or follows up on the suggestion.
                - REJECTED: User explicitly declines (no, stop, don't).
                - IGNORED: User asks a completely different question, asks about a different entity (e.g., specific vendor), or changes topic.

                Example:
                Suggestion: "Food"
                User: "Is Taye's Home Decor a vendor?"
                Status: IGNORED (Asking about vendor, not food product).

                Respond with JSON: { "status": "ACCEPTED" | "REJECTED" | "IGNORED" }`
            }
        ];

        const response = await queryAI(prompt, 64, 1);
        const start = response.indexOf('{');
        const end = response.lastIndexOf('}');

        if (start !== -1 && end !== -1) {
            const json = JSON.parse(response.substring(start, end + 1));
            return json.status?.toLowerCase() || 'ignored';
        }
    } catch (e) {
        console.error("[SuggestionHelper] AI check failed:", e.message);
    }

    return 'ignored'; // Default to ignored (safe)
}

module.exports = {
    isConfirmation,
    isImplicitReference,
    extractSuggestion,
    checkSuggestionAcknowledgement
};
