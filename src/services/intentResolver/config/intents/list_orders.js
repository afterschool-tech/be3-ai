/**
 * Intent: list_orders
 * Triggered when the user wants to see their order history or list of past orders.
 */

module.exports = {
    name: 'list_orders',
    class: 'Shopping_Management',
    intent: 'Post_Purchase',

    keywords: [
        'history', 'purchases', 'bought', 'past', 'previous'
    ],

    synonyms: [
        'orders', 'my orders', 'order history', 'past orders',
        'show my orders', 'list my orders', 'what did i order',
        'previous orders', 'purchase history', 'recent orders',
        'show order history', 'all my orders', 'what have i bought'
    ],

    parameters: {
        limit: { type: 'number', required: false, description: 'Number of orders to show (default 5)' }
    },

    toolName: 'order.list',

    paramMap: {
        limit: 'limit'
    },

    minProducts: 0,
    maxProducts: 0,
    invertTo: null,

    dco: {
        segments: ['core', 'formatting', 'grounding'],
        storeContext: 'none',
        historyDepth: 3,
        includeSummary: false,
        maxResponseTokens: 512
    }
};
