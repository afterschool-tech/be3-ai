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

    // Check for rotation_context from greetings
    if (handlerResult.rotation_context) {
        const { suggested_categories, what_we_can_do } = handlerResult.rotation_context;

        if (suggested_categories && suggested_categories.length > 0) {
            return {
                type: 'category_offer',
                intent: 'search_products',
                params: { category: suggested_categories[0] },
                text: suggested_categories[0]
            };
        }
    }

    // Pattern: "Would you like me to show you X?"
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

    // Pattern: "I can help you compare X"
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

    // Pattern: "Let me search for X" or "Let me find X"
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

module.exports = {
    isConfirmation,
    isImplicitReference,
    extractSuggestion
};
