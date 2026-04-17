/**
 * Intent: remove_from_cart
 * Triggered when the user wants to remove a product from their cart.
 */

module.exports = {
    name: 'remove_from_cart',
    class: 'Shopping_Management',
    intent: 'Cart_Management',

    keywords: [
        'remove', 'delete', 'drop', 'take out'
    ],

    synonyms: [
        'get rid of', 'ditch', 'cancel item', "don't want",
        'lose', 'scratch', 'nix', 'take away',
        'remove from cart', 'remove from basket', 'remove from bag',
        'take out of cart', 'take out of basket',
        'delete from cart', 'drop from cart'
    ],

    parameters: {
        products: { type: 'list', required: false, description: 'List of product names or references (e.g. ["iphone 12"], ["second item"]).' },
        cart_item_id: { type: 'string', required: false, description: 'Cart line item ID (set when user says "second item", "first item", etc.)' },
        quantity: { type: 'int', required: false, default: null, description: 'Quantity to remove (null = remove all)' }
    },

    slotTags: ['[product]', '[quantity]'],

    toolName: 'cart.remove',

    paramMap: {
        products: { target: 'product_id', expand: true },
        cart_item_id: 'cart_item_id'
    },

    minProducts: 1,
    maxProducts: null,
    invertTo: 'add_to_cart',

    dco: {
        segments: ['core', 'formatting', 'grounding'],
        storeContext: 'none',
        historyDepth: 3,
        includeSummary: false,
        maxResponseTokens: 512
    }
};
