/**
 * Intent: order_status
 * Triggered when the user wants to track an order or check delivery status.
 */

module.exports = {
    name: 'order_status',

    keywords: [
        'track', 'status', 'tracking', 'delivery', 'shipping', 'location', 'arrival'
    ],

    synonyms: [
        'track', 'tracking',
        'where is my order', "where's my order", 'track my order',
        'order status', 'order tracking', 'shipment',
        'shipped', 'arrived', 'when will', 'eta',
        'delivery status', 'check order', 'check my order',
        'track package', 'package status', 'where is my package',
        'order progress', 'shipping updates', 'is my order coming',
        'when does it arrive', 'trace my order', 'where is it', 'parcel status'
    ],

    parameters: {
        order_id: { type: 'string', required: false, description: 'Order ID or tracking number (if provided)' },
        products: { type: 'list', required: false, description: 'Product reference for context' }
    },

    slotTags: ['[order_id]', '[product]'],

    toolName: 'order.track',

    paramMap: {
        order_id: 'order_number'
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
     *  - collect_order_id: ask for a valid-looking order ID if missing/ambiguous
     */
    microstates: {
        collect_order_id: {
            trigger: (params, entities) => {
                // Trigger only when we don't already have an order_id
                return !params.order_id;
            },
            sandbox: 'soft',
            boostScore: 10.0,
            prompt: {
                tool: 'microstate.collect',
                params: {
                    paramName: 'order_id',
                    message: 'What is your order number?',
                    hint: 'e.g., #12345'
                }
            },
            // Per-param validators / normalizers
            validators: {
                order_id: (value) => {
                    if (!value) return false;
                    const v = String(value).trim();
                    return /^#?\d{3,}$/.test(v);
                }
            },
            normalizers: {
                order_id: (value) => {
                    if (!value) return value;
                    return String(value).trim().replace(/^#/, '');
                }
            },
            termination: {
                maxMessages: 2,
                onFulfilled: ['order_id'],
                escalation: null
            },
            breakthrough: {
                // Be relatively permissive to let users change topic if they want
                minScore: 2.5,
                blockIntents: []
            }
        }
    }
};
