/**
 * Intent: vendor_identity
 * Triggered when the user wants to know who/what a vendor or the platform is.
 * Now routes to rag.query — knowledge is served from indexed chunks (vendor profiles,
 * platform identity, etc.) rather than a live API lookup.
 */

module.exports = {
    name: 'vendor_identity',
    class: 'Vendor_Intelligence',
    intent: 'Vendor_Lookup',

    keywords: [
        'vendor', 'seller', 'brand', 'company', 'makes', 'sells', 'owns', 'who is', 'what is'
    ],

    synonyms: [
        'belongs to', 'sold by', 'who sells',
        'who sells this', 'which vendor', 'which seller',
        'is this from', 'who is the seller', 'vendor of this product',
        'where is this from', 'who made this', 'who provides this',
        'product vendor', 'product seller', 'from which store',
        'who owns', 'which country', 'who created', 'who founded', 'what company'
    ],

    parameters: {
        query: { type: 'string', required: true, description: 'The full user question about the vendor or platform identity' },
        vendor: { type: 'string', required: false, description: 'Vendor name extracted from context, if any' }
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
        segments: ['core', 'formatting', 'rag_context', 'grounding'],
        storeContext: 'none',
        historyDepth: 4,
        includeSummary: false,
        maxResponseTokens: 768
    }
};
