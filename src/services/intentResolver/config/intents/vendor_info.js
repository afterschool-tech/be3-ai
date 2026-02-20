/**
 * Intent: vendor_info
 * Triggered when the user wants to learn about a specific vendor.
 */

module.exports = {
    name: 'vendor_info',

    keywords: [
        'vendor', 'seller', 'store', 'about', 'details', 'info'
    ],

    synonyms: [
        'about vendor', 'vendor info', 'who is',
        'tell me about this vendor', 'vendor information', 'seller info',
        'who is this seller', 'about this store', 'vendor details',
        'learn about vendor', 'store information', 'seller details',
        'who runs this shop', 'about the seller'
    ],

    parameters: {
        vendor: { type: 'string', required: true, description: 'Vendor name or identifier' }
    },

    slotTags: ['[vendor]'],

    toolName: 'vendor.getInfo',

    paramMap: {
        vendor: 'vendor_name'
    },

    minProducts: 0,
    maxProducts: 0,
    invertTo: null
};
