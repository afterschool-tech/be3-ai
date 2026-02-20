/**
 * Intent: vendor_contact
 * Triggered when the user wants to contact or message a vendor.
 */

module.exports = {
    name: 'vendor_contact',

    keywords: [
        'contact', 'message', 'whatsapp', 'reach', 'talk', 'vendor', 'seller',
        'email', 'phone', 'support', 'help', 'address', 'location', 'number'
    ],

    synonyms: [
        'contact vendor', 'message seller', 'whatsapp vendor',
        'how to reach', 'talk to seller', 'send message to vendor',
        'contact seller', 'get in touch with', 'vendor whatsapp',
        'chat with vendor', 'reach the seller', 'vendor contact'
    ],

    parameters: {
        vendor: { type: 'string', required: true, description: 'Vendor name or identifier' }
    },

    slotTags: ['[vendor]'],

    toolName: 'vendor.getContactLink',

    paramMap: {
        vendor: 'vendor_name'
    },

    minProducts: 0,
    maxProducts: 0,
    invertTo: null
};
