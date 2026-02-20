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
    invertTo: null,

    /**
     * Microstates:
     *  - collect_vendor_for_info: ask which vendor to get info about when vendor is missing.
     */
    microstates: {
        collect_vendor_for_info: {
            trigger: (params, entities) => {
                return !params.vendor;
            },
            sandbox: 'soft',
            boostScore: 10.0,
            prompt: {
                tool: 'microstate.collect',
                params: {
                    paramName: 'vendor',
                    message: 'Which vendor would you like to know about?',
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
