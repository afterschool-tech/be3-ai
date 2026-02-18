/**
 * Intent: update_cart_quantity
 * Triggered when the user wants to change the quantity of an item already in the cart.
 */

module.exports = {
    name: 'update_cart_quantity',

    keywords: [
        'update', 'change', 'quantity', 'modify', 'bump', 'adjust', 'set'
    ],

    synonyms: [
        'change quantity', 'update quantity', 'make it 2', 'make it 3',
        'i want more', 'increase quantity', 'decrease quantity',
        'set quantity', 'change amount', 'update amount',
        'i need more of', 'fewer of', 'less of',
        'bump it up', 'adjust quantity'
    ],

    parameters: {
        products: { type: 'list', required: true, description: 'List of product names to update quantity for.' },
        product_name: { type: 'string', required: false, description: 'Single product name (fallback)' },
        quantity: { type: 'number', required: true, description: 'New quantity value' }
    },

    toolName: 'cart.updateQuantity',

    paramMap: {
        products: { target: 'cart_item_id', expand: true },
        product_name: 'cart_item_id',
        quantity: 'quantity'
    },

    minProducts: 1,
    maxProducts: 1,
    invertTo: null
};
