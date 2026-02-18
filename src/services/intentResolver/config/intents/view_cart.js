/**
 * Intent: view_cart
 * Triggered when the user wants to see what's in their cart.
 */

module.exports = {
    name: 'view_cart',

    keywords: [
        'cart', 'basket', 'bag'
    ],

    synonyms: [
        "what's in my cart", 'show cart', 'show my cart',
        'view cart', 'my cart', 'cart contents',
        'shopping bag', 'shopping basket', 'shopping cart',
        'what did i add', 'what have i added',
        'see my cart', 'open cart', 'check cart',
        'cart summary', 'items in cart', 'items in my cart'
    ],

    parameters: {},

    toolName: 'cart.view',

    paramMap: {},

    minProducts: 0,
    maxProducts: 0,
    invertTo: null
};
