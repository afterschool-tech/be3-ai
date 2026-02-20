/**
 * Intent: add_to_cart
 * Triggered when the user wants to add a product to their shopping cart.
 */

module.exports = {
    name: 'add_to_cart',

    keywords: [
        'add', 'cart'
    ],

    synonyms: [
        'throw in', 'put in', 'grab', 'cop',
        "i'll take", 'gimme', 'hook me up with', 'i would like',
        'add to cart', 'add to basket', 'add to bag',
        'put in cart', 'put in basket', 'put in bag',
        'add it to cart', 'add this to cart', 'add that to cart',
        'add it to my cart', 'add this to my cart', 'add that to my cart',
        'buy it', 'purchase it', 'order it',
        'let me get', 'let me buy', 'grab', 'cop'
    ],

    parameters: {
        products: { type: 'list', required: false, description: 'List of product names ONLY (e.g. ["iphone 12"]). Do NOT include cart verbs or sentences.' },
        product_name: { type: 'string', required: false, description: 'Single product name (fallback)' },
        query: { type: 'string', required: false, description: 'Single product query (fallback)' },
        quantity: { type: 'int', required: false, default: 1, description: 'Quantity to add' },
        vendor: { type: 'string', required: false, description: 'Vendor/brand filter' },
        attributes: { type: 'dict', required: false, description: 'Product attributes like color, size' },
        clause_words: { type: 'list', required: false, description: 'Detected semantic clauses' }
    },

    slotTags: ['[product]', '[quantity]', '[clause]', '[vendor]'],

    toolName: 'cart.add',

    paramMap: {
        products: { target: 'product_id', expand: true },
        product_name: 'product_id',
        query: 'product_id',
        quantity: 'quantity'
    },

    minProducts: 1,
    maxProducts: null,
    invertTo: 'remove_from_cart'
};
