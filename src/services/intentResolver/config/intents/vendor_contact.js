/**
 * Intent: vendor_contact
 * Triggered when the user wants to contact or message a vendor.
 */

module.exports = {
    name: 'vendor_contact',

    keywords: [
        'contact', 'message', 'whatsapp', 'reach', 'talk', 'vendor', 'seller',
        'email', 'support', 'help', 'address', 'location', 'number'
    ],

    synonyms: [
        'contact vendor', 'message seller', 'whatsapp vendor',
        'how to reach', 'talk to seller', 'send message to vendor',
        'contact seller', 'get in touch with', 'vendor whatsapp',
        'chat with vendor', 'reach the seller', 'vendor contact'
    ],

    parameters: {
        vendor: { type: 'string', required: true, description: 'Vendor name or identifier' }
    },

    slotTags: ['[vendor]'],

    toolName: 'vendor.getContactLink',

    paramMap: {
        vendor: 'vendor_name'
    },

    minProducts: 0,
    maxProducts: 0,
    invertTo: null,

    /**
     * Microstates:
     *  - collect_vendor_for_contact: ask which vendor to contact when vendor is missing.
     */
    microstates: {
        collect_vendor_for_contact: {
            trigger: (params, entities) => {
                return !params.vendor;
            },
            sandbox: 'soft',
            boostScore: 10.0,
            prompt: {
                tool: 'microstate.collect',
                params: {
                    paramName: 'vendor',
                    message: 'Which vendor do you want to contact?',
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
