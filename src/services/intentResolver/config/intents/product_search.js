/**
 * Intent: product_search
 * Triggered when the user wants to find, browse, or search for products.
 */

module.exports = {
    name: 'product_search',

    keywords: [
        'search', 'find', 'look', 'browse', 'explore', 'discover'
    ],

    synonyms: [
        'show me', 'let me see', 'i want to see', 'looking for',
        'do you have', 'what do you have', 'any', 'got any',
        'help me find', 'where can i find',
        'display', 'view', 'buy', 'want', 'get', 'need'
    ],

    parameters: {
        product_name: { type: 'string', required: true, description: 'Extracted product name or keywords ONLY (e.g. "iphone 12"). Do NOT include full sentences or filler words.' },
        category: { type: 'string', required: false, description: 'Category filter' },
        vendor: { type: 'string', required: false, description: 'Vendor/brand filter' },
        price_min: { type: 'number', required: false, description: 'Minimum price' },
        price_max: { type: 'number', required: false, description: 'Maximum price' },
        sort: { type: 'string', required: false, description: 'Sort order (low-to-high, high-to-low, newest)' },
        limit: { type: 'int', required: false, default: 5, description: 'Number of results' },
        attributes: { type: 'dict', required: false, description: 'Dynamic attribute filters' }
    },

    toolName: 'product.search',

    paramMap: {
        product_name: 'query',
        category: 'category',
        vendor: 'tag',
        price_min: 'price_min',
        price_max: 'price_max',
        sort: 'sort',
        limit: 'limit',
        attributes: 'attributes'
    },

    minProducts: 0,
    maxProducts: null,
    invertTo: null
};
