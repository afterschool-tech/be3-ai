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
    invertTo: null
};
