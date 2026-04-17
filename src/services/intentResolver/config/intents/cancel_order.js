/**
 * Intent: cancel_order
 * Triggered when the user wants to cancel an existing order.
 */

module.exports = {
    name: 'cancel_order',
    class: 'Shopping_Management',
    intent: 'Post_Purchase',

    keywords: [
        'cancel', 'abort', 'revoke', 'kill', 'stop', 'remove', 'abandon'
    ],

    synonyms: [
        'cancel my order', 'cancel order', 'abort order',
        'i want to cancel', 'undo my order', 'stop my order',
        'cancel this order', 'i changed my mind', 'revoke order',
        'cancel purchase', 'void order'
    ],

    parameters: {
        order_number: { type: 'string', required: true, description: 'Order number or ID to cancel' }
    },

    slotTags: ['[order_id]'],

    toolName: 'order.cancel',

    paramMap: {
        order_number: 'order_number'
    },

    minProducts: 0,
    maxProducts: 0,
    invertTo: null,

    dco: {
        segments: ['core', 'formatting', 'grounding'],
        storeContext: 'none',
        historyDepth: 3,
        includeSummary: false,
        maxResponseTokens: 512
    },
    /**
     * Microstates:
     *  - collect_cancel_order_id: collect a concrete order_number when missing
     */
    microstates: {
        collect_cancel_order_id: {
            trigger: (params, entities) => {
                return !params.order_number;
            },
            sandbox: 'soft',
            boostScore: 10.0,
            prompt: {
                tool: 'microstate.collect',
                params: {
                    paramName: 'order_number',
                    message: 'Which order would you like to cancel?',
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
