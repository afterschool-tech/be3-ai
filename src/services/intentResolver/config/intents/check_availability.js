/**
 * Intent: check_availability
 * Triggered when the user wants to know if a product is in stock.
 */

module.exports = {
    name: 'check_availability',

    keywords: [
        'available', 'in stock', 'stock', 'availability'
    ],

    synonyms: [
        'do you have', 'is it available', 'is it in stock',
        'can i get', 'got any', 'is there', 'have you got',
        'any left', 'still available', 'still in stock',
        'out of stock', 'sold out', 'back in stock',
        'check stock', 'check availability'
    ],

    parameters: {
        products: { type: 'list', required: false, description: 'List of product names ONLY (e.g. ["iphone 12"]). Do NOT include availability verbs or sentences.' },
        product_name: { type: 'string', required: false, description: 'Single product name (fallback)' },
        query: { type: 'string', required: false, description: 'Single product query (fallback)' },
        vendor: { type: 'string', required: false, description: 'Vendor filter' }
    },

    toolName: 'product.checkAvailability',

    paramMap: {
        products: { target: 'product_id', expand: true },
        product_name: 'product_id',
        query: 'product_id'
    },

    minProducts: 1,
    maxProducts: null,
    invertTo: null
};
