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
    invertTo: null,

    /**
     * Microstates:
     *  - collect_vendor_for_products: ask which vendor's products to show when vendor is missing.
     */
    microstates: {
        collect_vendor_for_products: {
            trigger: (params, entities) => {
                return !params.vendor;
            },
            sandbox: 'soft',
            boostScore: 10.0,
            prompt: {
                tool: 'microstate.collect',
                params: {
                    paramName: 'vendor',
                    message: 'Which vendor do you want to see products from?',
                    hint: 'e.g., "Taye\'s Home Decor"'
                }
            },
            validators: {
                vendor: (value) => {
                    if (!value) return false;
                    return String(value).trim().length > 1;
                }
            },
            normalizers: {
                vendor: (value) => value ? String(value).trim() : value
            },
            termination: {
                maxMessages: 2,
                onFulfilled: ['vendor'],
                escalation: null
            },
            breakthrough: {
                minScore: 1.5,
                blockIntents: []
            }
        }
    }
};
