/**
 * Intent: vendor_identity
 * Triggered when the user wants to identify which vendor sells a specific product.
 */

module.exports = {
    name: 'vendor_identity',

    keywords: [
        'vendor', 'seller', 'brand', 'company', 'makes', 'sells'
    ],

    synonyms: [
        'belongs to', 'sold by', 'who sells',
        'who sells this', 'which vendor', 'which seller',
        'is this from', 'who is the seller', 'vendor of this product',
        'where is this from', 'who made this', 'who provides this',
        'product vendor', 'product seller', 'from which store'
    ],

    parameters: {
        product_name: { type: 'string', required: true, description: 'Product name to identify vendor for' },
        vendor: { type: 'string', required: false, description: 'Vendor name to check against (optional)' }
    },

    slotTags: ['[product]', '[vendor]'],

    toolName: 'vendor.checkIdentity',

    paramMap: {
        product_name: 'product_name',
        vendor: 'vendor_name'
    },

    minProducts: 1,
    maxProducts: 1,
    invertTo: null
};
