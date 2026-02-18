/**
 * Intent: order_status
 * Triggered when the user wants to track an order or check delivery status.
 */

module.exports = {
    name: 'order_status',

    keywords: [
        'track', 'status', 'tracking'
    ],

    synonyms: [
        'order', 'delivery',
        'where is my order', "where's my order", 'track my order',
        'order status', 'order tracking', 'shipment',
        'shipped', 'arrived', 'when will', 'eta',
        'delivery status', 'check order', 'check my order',
        'track package', 'package status', 'where is my package'
    ],

    parameters: {
        order_id: { type: 'string', required: false, description: 'Order ID or tracking number (if provided)' },
        products: { type: 'list', required: false, description: 'Product reference for context' }
    },

    toolName: 'order.track',

    paramMap: {
        order_id: 'order_number'
    },

    minProducts: 0,
    maxProducts: 0,
    invertTo: null
};
