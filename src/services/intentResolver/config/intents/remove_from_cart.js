/**
 * Intent: remove_from_cart
 * Triggered when the user wants to remove a product from their cart.
 */

module.exports = {
    name: 'remove_from_cart',

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
        products: { type: 'list', required: true, description: 'List of product names ONLY (e.g. ["iphone 12"]). Do NOT include removal verbs or sentences.' },
        quantity: { type: 'int', required: false, default: null, description: 'Quantity to remove (null = remove all)' }
    },

    toolName: 'cart.remove',

    paramMap: {
        products: { target: 'product_id', expand: true }
    },

    minProducts: 1,
    maxProducts: null,
    invertTo: 'add_to_cart'
};
