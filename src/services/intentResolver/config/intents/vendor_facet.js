/**
 * Intent: vendor_facet
 * Triggers: Queries asking for a list of vendors/sellers/stores that carry a specific product,
 *           or generic questions about which vendors are available for a category.
 * 
 * Maps directly to the product.facets tool but forces the target to be 'vendor'.
 */

module.exports = {
    name: 'vendor_facet',
    class: 'Vendor_Intelligence',
    intent: 'Vendor_Catalog_Exploration',

    keywords: [
        'who sells', 'which store', 'which vendor', 'what vendors', 'what stores',
        'what sellers', 'which sellers', 'list of vendors', 'list of stores'
    ],

    synonyms: [
        // Product-specific vendor queries
        'who sells this', 'which vendors have', 'what stores carry',
        'where can i buy', 'who stocks', 'who has this in stock',
        'can i see sellers for', 'show me stores that sell',

        // Category/General vendor queries
        'what stores are here', 'which vendors sell', 'list all sellers',
        'what sellers are available', 'show me merchants', 'who are the sellers'
    ],

    parameters: {
        product_query: { type: 'string', required: false, description: 'Product name to scope the vendors' },
        category: { type: 'string', required: false, description: 'Category to scope the vendors' },
        facet_target: { type: 'string', required: false, default: 'vendor', description: 'Hardcoded target for facet search' },
        attributes: { type: 'object', required: false, description: 'Dynamic attribute filters resolved by the pipeline' }
    },

    slotTags: {
        product_query: ['[product]', '[residual]'],
        category: ['[category]']
    },

    toolName: 'product.facets',

    paramMap: {
        product_query: 'query',
        category: 'category',
        facet_target: 'facet_target',
        attributes: 'attributes'
    },

    dco: {
        segments: ['core', 'formatting', 'grounding'],
        storeContext: 'none',
        historyDepth: 3,
        includeSummary: false,
        maxResponseTokens: 512
    }
};
