/**
 * Intent: set_delivery
 * Triggered when the user wants to set or change delivery / shipping preferences.
 */

module.exports = {
    name: 'set_delivery',

    keywords: [
        'delivery', 'shipping', 'express', 'standard', 'address', 'location', 'delivered'
    ],

    synonyms: [
        'set delivery', 'change shipping', 'delivery options',
        'shipping method', 'express delivery', 'standard shipping',
        'how will it be delivered', 'delivery address',
        'ship to', 'deliver to', 'change delivery',
        'shipping preference', 'delivery method'
    ],

    parameters: {
        delivery_type: { type: 'string', required: false, description: 'Delivery type (express, standard, pickup)' },
        address: { type: 'string', required: false, description: 'Delivery address' }
    },

    toolName: 'order.setDelivery',

    paramMap: {
        delivery_type: 'delivery_type',
        address: 'address'
    },

    minProducts: 0,
    maxProducts: 0,
    invertTo: null,

    /**
     * Microstates:
     *  - collect_delivery_details: collect address (required) and optionally delivery_type
     */
    microstates: {
        collect_delivery_details: {
            trigger: (params, entities) => {
                // Trigger when at least one of the key delivery parameters is missing
                return !params.address || !params.delivery_type;
            },
            sandbox: 'soft',
            boostScore: 10.0,
            // Ordered field metadata for multi-field collection
            fields: [
                { name: 'address', required: true },
                { name: 'delivery_type', required: false }
            ],
            prompt: {
                // First step: explicitly ask for the address
                tool: 'microstate.collect',
                params: {
                    paramName: 'address',
                    message: 'What is the delivery address?',
                    hint: 'e.g., "10 Broad Street, Lagos"'
                }
            },
            termination: {
                // We consider the microstate fulfilled once we have at least an address.
                maxMessages: 3,
                onFulfilled: ['address', 'delivery_type'],
                escalation: null
            },
            // Simple validation: require non-trivial address text
            validators: {
                address: (value) => {
                    if (!value) return false;
                    return String(value).trim().length >= 5;
                }
            },
            normalizers: {
                address: (value) => value ? String(value).trim() : value
            },
            breakthrough: {
                // Allow user to pivot away if they strongly express another intent
                minScore: 2.5,
                blockIntents: []
            }
        }
    }
};
