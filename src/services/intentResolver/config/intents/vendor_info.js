/**
 * Intent: vendor_info
 * Triggered when the user wants to learn about a specific vendor or the platform.
 * Now routes to rag.query — vendor profiles and platform info are indexed in the KB.
 */

module.exports = {
    name: 'vendor_info',
    class: 'Vendor_Intelligence',
    intent: 'Vendor_Lookup',

    keywords: [
        'vendor', 'seller', 'store', 'about', 'details', 'info', 'merchant', 'business', 'profile', 'location'
    ],

    synonyms: [
        'about vendor', 'vendor info', 'who is',
        'tell me about this vendor', 'vendor information', 'seller info',
        'who is this seller', 'about this store', 'vendor details',
        'learn about vendor', 'store information', 'seller details',
        'who runs this shop', 'about the seller',
        'vendor location', 'where is this store', 'is this vendor trusted',
        'vendor ratings', 'more on this seller', 'who is behind', 'owner info'
    ],

    parameters: {
        query: { type: 'string', required: true, description: 'Full user question about the vendor or store' },
        vendor: { type: 'string', required: false, description: 'Vendor name or id extracted from context' }
    },

    slotTags: ['[vendor]'],

    toolName: 'rag.query',

    paramMap: {
        query: 'query',
        vendor: 'vendor'
    },

    minProducts: 0,
    maxProducts: 0,
    invertTo: null,

    dco: {
        segments: ['core', 'formatting', 'rag_context', 'grounding', 'suggestions'],
        storeContext: 'none',
        historyDepth: 4,
        includeSummary: false,
        maxResponseTokens: 768
    }
};
