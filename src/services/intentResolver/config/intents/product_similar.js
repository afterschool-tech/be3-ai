/**
 * Intent: product_similar
 * Triggered when the user wants to find products similar or alternative to a specific reference.
 */

module.exports = {
    name: 'product_similar',

    keywords: [
        'similar to',
        'something like',
        'alternatives to',
        'equivalent to',
        'comparable to',
        'like this one',
        'like that one',
        'show similar',
        'find similar',
        'more like this',
        'more like that'
    ],

    synonyms: [
        'what else is like',
        'anything like',
        'products like',
        'items like',
        'what is similar',
        'do you have something similar',
        'something in the same range',
        'same kind of',
        'same type of',
        'close to this',
        'close to that',
        'in the same category as',
        'other options like',
        'other products like',
        'recommend something like',
        'suggest something like',
        'what compares to',
        'what is close to',
        'resembles',
        'look alike',
        'feels like',
        'kind of like',
        'along the lines of',
        'in that direction',
        'that type of thing',
        'that kind of product'
    ],

    parameters: {
        product_name: { type: 'string', required: true, description: 'The Product ID, Name or Handle to find products similar to' },
        category: { type: 'string', required: false, description: 'Category filter for the similarity search' },
        price_min: { type: 'number', required: false, description: 'Minimum price filter' },
        price_max: { type: 'number', required: false, description: 'Maximum price filter' },
        attributes: { type: 'dict', required: false, description: 'Dynamic attribute filters' }
    },

    slotTags: ['[clause]', '[product]', '[category]'],

    toolName: 'product.search',

    paramMap: {
        product_name: 'similar_to',
        category: 'category',
        price_min: 'price_min',
        price_max: 'price_max',
        attributes: 'attributes'
    },

    minProducts: 1,
    maxProducts: 1,
    invertTo: null,

    dco: {
        segments: ['core', 'formatting', 'grounding', 'similarity', 'suggestions'],
        storeContext: 'none',
        historyDepth: 4,
        includeSummary: true,
        maxResponseTokens: 1024
    }
};
