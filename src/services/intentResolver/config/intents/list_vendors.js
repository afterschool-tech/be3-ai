/**
 * Intent: list_vendors
 * Triggered when the user wants to see a list of all available vendors/stores.
 */

module.exports = {
    name: 'list_vendors',
    class: 'Vendor_Intelligence',
    intent: 'Vendor_Lookup',

    keywords: [
        'vendors', 'sellers', 'stores', 'shops', 'brands'
    ],

    synonyms: [
        'list vendors', 'show all stores', 'which sellers',
        'what brands are available', 'list of sellers', 'all shops',
        'show available vendors', 'who sells on here', 'marketplace sellers',
        'directory', 'list all vendors'
    ],

    parameters: {},

    toolName: 'vendor.list',

    paramMap: {},

    minProducts: 0,
    maxProducts: 0,
    invertTo: null,

    dco: {
        segments: ['core', 'formatting', 'grounding', 'vendor_rules'],
        storeContext: 'none',
        historyDepth: 3,
        includeSummary: false,
        maxResponseTokens: 768
    }
};
