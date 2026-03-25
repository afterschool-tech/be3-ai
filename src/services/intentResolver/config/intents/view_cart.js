/**
 * Intent: view_cart
 * Triggered when the user wants to see what's in their cart.
 */

module.exports = {
    name: 'view_cart',

    keywords: [
        'cart', 'basket', 'bag', 'summary', 'contents'
    ],

    synonyms: [
        "what's in my cart", 'show cart', 'show my cart', 'show me my cart',
        'view cart', 'my cart', 'cart contents', 'let me see my cart',
        'shopping bag', 'shopping basket', 'shopping cart',
        'what did i add', 'what have i added', 'tell me what i got',
        'see my cart', 'open cart', 'check cart', 'can i see my cart',
        'cart summary', 'items in cart', 'items in my cart', 'view my basket',
        'review my order', 'my selection', 'checkout list', 'cart details',
        'show my bag', 'what am i buying', 'my shopping list', 'items i picked'
    ],

    parameters: {},

    toolName: 'cart.view',

    paramMap: {},

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
