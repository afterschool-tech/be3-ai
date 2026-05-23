/**
 * Intent: check_availability
 * Triggered when the user wants to know if a product is in stock.
 */

module.exports = {
    name: 'check_availability',
    class: 'Shopping_Management',
    intent: 'Checkout_Flow',

    keywords: [
        'available', 'in stock', 'stock', 'availability', 'exists', 'presence', 'inventory'
    ],

    synonyms: [
        'is it available', 'is it in stock',
        'is there', 'have you got',
        'any left', 'still available', 'still in stock',
        'out of stock', 'sold out', 'back in stock',
        'check stock', 'check availability',
        'can i buy this now', 'is it ready', 'do you have it', 'is it still there',
        'stock level', 'quantity available', 'is this item in'
    ],

    parameters: {
        products: { type: 'list', required: false, description: 'List of product names ONLY (e.g. ["iphone 12"]). Do NOT include availability verbs or sentences.' },
        product_name: { type: 'string', required: false, description: 'Single product name (fallback)' },
        query: { type: 'string', required: false, description: 'Single product query (fallback)' },
        clause_words: { type: 'list', required: false, description: 'Detected semantic clauses' },
        attributes: { type: 'dict', required: false, description: 'Semantic attributes' }
    },

    slotTags: ['[product]', '[clause]'],

    toolName: 'product.checkAvailability',

    paramMap: {
        products: { target: 'product_id', expand: true },
        product_name: 'product_id',
        query: 'product_id'
    },

    minProducts: 1,
    maxProducts: null,
    invertTo: null,

    dco: {
        segments: ['core', 'formatting', 'grounding'],
        storeContext: 'none',
        historyDepth: 3,
        includeSummary: false,
        maxResponseTokens: 512
    }
};
