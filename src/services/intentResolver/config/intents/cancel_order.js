/**
 * Intent: cancel_order
 * Triggered when the user wants to cancel an existing order.
 */

module.exports = {
    name: 'cancel_order',

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

    toolName: 'order.cancel',

    paramMap: {
        order_number: 'order_number'
    },

    minProducts: 0,
    maxProducts: 0,
    invertTo: null
};
