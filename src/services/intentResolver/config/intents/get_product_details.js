/**
 * Intent: get_product_details
 * Triggered when the user wants to see specific details, specs, or more information about a product.
 */

module.exports = {
    name: 'get_product_details',

    keywords: [
        'details', 'info', 'information', 'specs', 'specifications', 'features', 'more',
        'battery', 'camera', 'display', 'screen', 'processor', 'ram', 'storage', 'memory',
        'material', 'warranty', 'box', 'ports', 'software', 'waterproof', 'authentic'
    ],

    synonyms: [
        'tell me more', 'what are the specs', 'show me details', 'product info',
        'what can you tell me about', 'describe', 'details for', 'specs for',
        'tell me about', 'more info on', 'technical specs', 'want to know more',
        'is there more info', 'show features', 'give me details',
        'battery life', 'camera specs', 'screen size', 'box contents', 'warranty period',
        'is it original', 'authentic model', 'water resistant'
    ],

    parameters: {
        product_name: { type: 'string', required: false, description: 'The name or identifier of the product' },
        product_id: { type: 'string', required: false, description: 'Specific product UUID if known' }
    },

    slotTags: ['[product]'],

    toolName: 'product.getDetails',

    paramMap: {
        product_name: 'product_id', // resolveProduct handles name-to-id resolution
        product_id: 'product_id'
    },

    minProducts: 1,
    maxProducts: 1,
    invertTo: null,

    dco: {
        segments: ['core', 'formatting', 'grounding', 'suggestions'],
        storeContext: 'none',
        historyDepth: 4,
        includeSummary: true,
        maxResponseTokens: 1024
    }
};
