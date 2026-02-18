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
    invertTo: null
};
