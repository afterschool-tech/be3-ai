/**
 * Intent: start_checkout
 * Triggered when the user wants to proceed to checkout / pay for their cart.
 */

module.exports = {
    name: 'start_checkout',

    keywords: [
        'checkout', 'pay', 'purchase', 'buy now', 'place order'
    ],

    synonyms: [
        'proceed to checkout', 'ready to pay', 'i want to pay',
        'finalize order', 'complete purchase', 'submit order',
        'go to checkout', 'check out', 'pay for my cart',
        'i want to checkout', 'take my money', 'process my order',
        'ready to buy', 'how do i pay', 'payment'
    ],

    parameters: {
        customer_name: { type: 'string', required: false, description: 'Customer name for WhatsApp orders' },
        customer_email: { type: 'string', required: false, description: 'Customer email for WhatsApp orders' }
    },

    toolName: 'order.checkout',

    paramMap: {
        customer_name: 'customer_name',
        customer_email: 'customer_email'
    },

    minProducts: 0,
    maxProducts: 0,
    invertTo: null
};
