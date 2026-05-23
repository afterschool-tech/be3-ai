/**
 * Intent: semantic_search
 * Triggered when the user needs shopping advice, recommendations, or guidance.
 * This intent is AI-powered and should only fire when the user clearly needs guidance.
 */

module.exports = {
    name: 'semantic_search',
    class: 'Discovery',
    intent: 'Product_Research',

    keywords: [
        'advice', 'should', 'ought', 'recommend', 'suggest', 'guidance', 'advisor',
        'should i buy', 'what to buy', 'recommend me'
    ],

    synonyms: [
        'buy', 'choose', 'pick',
        'what should i buy', 'what do you recommend', 'can you suggest',
        'recommendation', 'suggestion', 'tips', 'guide', 'advice for',
        'i need advice', 'help me choose', 'help me decide',
        'which one should i get', 'what is the best', 'best option',
        'i am confused', 'not sure what to pick', 'guide me',
        'what would you suggest', 'any recommendations', 'tips for buying'
    ],

    parameters: {
        category: { type: 'string', required: false, description: 'Category the user needs advice about' },
        product_name: { type: 'string', required: false, description: 'Specific items to get advice about (from residual words)' },
        need: { type: 'string', required: false, description: 'Specific need or use case (e.g. "gaming", "budget", "a gift")' },
        query: { type: 'string', required: false, description: 'The full advice query from the user' },
        search_mode: { type: 'string', required: false, default: 'VECTOR', description: 'Internal tool routing mode' },
        price_min: { type: 'number', required: false },
        price_max: { type: 'number', required: false },
        attributes: { type: 'dict', required: false },
        allow_deep_fallbacks: { type: 'boolean', required: false, default: true },
        is_partial_match: { type: 'boolean', required: false },
        _category_words: { type: 'string', required: false }
    },

    toolName: 'product.search',

    paramMap: {
        category: 'category',
        need: 'need',
        query: 'query',
        product_name: 'query',
        search_mode: 'search_mode',
        price_min: 'price_min',
        price_max: 'price_max',
        attributes: 'attributes',
        allow_deep_fallbacks: 'allow_deep_fallbacks',
        is_partial_match: 'is_partial_match',
        _category_words: '_category_words'
    },

    minProducts: 0,
    maxProducts: 0,
    invertTo: null,

    dco: {
        segments: ['core', 'formatting', 'grounding', 'suggestions'],
        storeContext: 'none',
        historyDepth: 6,
        includeSummary: true,
        maxResponseTokens: 1024
    }
};
