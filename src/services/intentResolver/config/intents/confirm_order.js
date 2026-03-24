/**
 * Intent: confirm_order
 * Triggered when the user wants to confirm/finalize a pending order.
 */

module.exports = {
    name: 'confirm_order',

    keywords: [
        'confirm', 'finalize', 'approve'
    ],

    synonyms: [
        'confirm my order', 'finalize order', 'place the order',
        'yes confirm', 'go ahead', 'approve order', 'submit order',
        'proceed with order', 'yes place it', 'confirm purchase',
        'lock it in', 'place my order'
    ],

    parameters: {
        order_number: { type: 'string', required: false, description: 'Order number to confirm (if known)' }
    },

    toolName: 'order.confirm',

    paramMap: {
        order_number: 'order_number'
    },

    minProducts: 0,
    maxProducts: 0,
    invertTo: null,

    /**
     * Microstates:
     *  - collect_confirm_order_id: ask which order to confirm when missing
     */
    microstates: {
        collect_confirm_order_id: {
            trigger: (params, entities) => {
                return !params.order_number;
            },
            sandbox: 'soft',
            boostScore: 10.0,
            prompt: {
                tool: 'microstate.collect',
                params: {
                    paramName: 'order_number',
                    message: 'Which order would you like to confirm?',
                    hint: 'Send the order number, e.g., #12345'
                }
            },
            validators: {
                order_number: (value) => {
                    if (!value) return false;
                    const v = String(value).trim();
                    return /^#?\d{3,}$/.test(v);
                }
            },
            normalizers: {
                order_number: (value) => {
                    if (!value) return value;
                    return String(value).trim().replace(/^#/, '');
                }
            },
            termination: {
                maxMessages: 2,
                onFulfilled: ['order_number'],
                escalation: null
            },
            breakthrough: {
                minScore: 2.5,
                blockIntents: []
            }
        }
    }
};
