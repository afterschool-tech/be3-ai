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
        product_name: 'product',
        vendor: 'vendor'
    },

    minProducts: 1,
    maxProducts: 1,
    invertTo: null,

    dco: {
        segments: ['core', 'formatting', 'grounding', 'vendor_rules'],
        storeContext: 'none',
        historyDepth: 4,
        includeSummary: false,
        maxResponseTokens: 768
    },
    /**
     * Microstates:
     *  - collect_product_for_vendor_identity: ask which product they're asking about when product_name is missing.
     */
    microstates: {
        collect_product_for_vendor_identity: {
            trigger: (params, entities) => {
                return !params.product_name;
            },
            sandbox: 'soft',
            boostScore: 10.0,
            prompt: {
                tool: 'microstate.collect',
                params: {
                    paramName: 'product_name',
                    message: 'Which product are you asking about?',
                    hint: 'e.g., "iPhone 16" or "Samsung Galaxy S24"'
                }
            },
            validators: {
                product_name: (value) => {
                    if (!value) return false;
                    return String(value).trim().length > 1;
                }
            },
            normalizers: {
                product_name: (value) => value ? String(value).trim() : value
            },
            termination: {
                maxMessages: 2,
                onFulfilled: ['product_name'],
                escalation: null
            },
            breakthrough: {
                minScore: 2.5,
                blockIntents: []
            }
        }
    }
};
