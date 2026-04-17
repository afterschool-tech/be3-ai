/**
 * Intent: update_cart_quantity
 * Triggered when the user wants to change the quantity of an item already in the cart.
 */

module.exports = {
    name: 'update_cart_quantity',
    class: 'Shopping_Management',
    intent: 'Cart_Management',

    keywords: [
        'update', 'change', 'quantity', 'modify', 'bump', 'adjust', 'set'
    ],

    synonyms: [
        'change quantity', 'update quantity', 'make it 2', 'make it 3',
        'i want more', 'increase quantity', 'decrease quantity',
        'set quantity', 'change amount', 'update amount',
        'i need more of', 'fewer of', 'less of',
        'bump it up', 'adjust quantity'
    ],

    parameters: {
        products: { type: 'list', required: true, description: 'List of product names to update quantity for.' },
        product_name: { type: 'string', required: false, description: 'Single product name (fallback)' },
        quantity: { type: 'number', required: true, description: 'New quantity value' }
    },

    toolName: 'cart.updateQuantity',

    paramMap: {
        // We pass a product identifier (name or ID) and let the tool
        // resolve it to the correct cart_item_id based on the current cart.
        products: { target: 'product_id', expand: false },
        product_name: 'product_id',
        quantity: 'quantity'
    },

    minProducts: 1,
    maxProducts: 1,
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
     *  - collect_quantity: ask for a clear quantity when missing or invalid
     */
    microstates: {
        collect_quantity: {
            trigger: (params, entities) => {
                // Trigger when quantity is missing or clearly invalid
                if (params.quantity === undefined || params.quantity === null) return true;
                const q = Number(params.quantity);
                return Number.isNaN(q) || q <= 0 || q > 100;
            },
            sandbox: 'soft',
            boostScore: 10.0,
            prompt: {
                tool: 'microstate.collect',
                params: {
                    paramName: 'quantity',
                    message: 'What quantity should I set for this item?',
                    hint: 'Use a whole number between 1 and 100'
                }
            },
            validators: {
                quantity: (value) => {
                    const q = Number(value);
                    return Number.isInteger(q) && q >= 1 && q <= 100;
                }
            },
            normalizers: {
                quantity: (value) => {
                    const q = Number(value);
                    return Number.isNaN(q) ? value : q;
                }
            },
            termination: {
                maxMessages: 2,
                onFulfilled: ['quantity'],
                escalation: null
            },
            features: [
                'show_captured'
            ],
            breakthrough: {
                minScore: 2.5,
                blockIntents: [],
                show_captured: true
            }
        }
    }
};
