/**
 * Intent: discovery_sentinel
 * A deterministic shadow of product_search. Triggered for broad discovery queries 
 * where category-level browsing may be more appropriate than keyword search.
 * 
 * This intent is NOT AI-powered. It uses string matching and category inventory 
 * to verify and recover search results.
 */

module.exports = {
    name: 'discovery_sentinel',

    keywords: [
        'discover', 'explore', 'browse', 'surprise', 'new', 'recommendation'
    ],

    synonyms: [
        'show me everything', 'what do you sell', 'what is available',
        'browse products', 'explore your store', 'discover products',
        'show me things', 'what can i find', 'show me your stuff',
        'all products', 'everything you have', 'just show me'
    ],

    parameters: {
        query: { type: 'string', required: false, description: 'Discovery query or category hint' },
        category: { type: 'string', required: false, description: 'Category to explore' }
    },

    toolName: 'discovery.sentinel',

    paramMap: {
        query: 'query',
        category: 'category'
    },

    minProducts: 0,
    maxProducts: 0,
    invertTo: null,

    dco: {
        segments: ['core', 'formatting', 'grounding', 'suggestions'],
        storeContext: 'none',
        historyDepth: 4,
        includeSummary: true,
        maxResponseTokens: 768
    }
};
