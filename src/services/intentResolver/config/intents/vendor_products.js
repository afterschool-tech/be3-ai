/**
 * Intent: vendor_products
 * Triggered when the user wants to see products from a specific vendor / seller.
 */

module.exports = {
    name: 'vendor_products',

    keywords: [
        'vendor', 'seller', 'store', 'shop', 'sell', 'sells', 'from'
    ],

    synonyms: [
        'show me products from', 'vendor products', 'seller products',
        'what does this vendor sell', 'products by', 'items from',
        'browse vendor', 'shop products', 'store items',
        "vendor's products", "seller's items", 'from this seller',
        'from', 'by'
    ],

    parameters: {
        vendor: { type: 'string', required: true, description: 'Vendor name or identifier' },
        limit: { type: 'number', required: false, description: 'Max products to return' },
        clause_words: { type: 'list', required: false, description: 'Detected semantic clauses' },
        attributes: { type: 'dict', required: false, description: 'Semantic attributes' }
    },

    slotTags: ['[vendor]', '[product]'],

    toolName: 'vendor.getProducts',

    paramMap: {
        vendor: 'vendor_name',
        limit: 'limit'
    },

    minProducts: 0,
    maxProducts: 0,
    invertTo: null
};
