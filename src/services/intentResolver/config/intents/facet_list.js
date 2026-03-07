/**
 * Intent: facet_list
 * Triggers: Queries about available product attributes (e.g., "what colors", "available storage").
 * 
 * Parameters:
 *  - facet_target: The specific attribute being asked about (e.g., color, storage, brand).
 *  - category: The product category to scope the search (optional).
 *  - vendor: The vendor to scope the search (optional).
 */

module.exports = {
    name: 'facet_list',
    keywords: ['what', 'which', 'available', 'list', 'show'],
    synonyms: [
        'what colors', 'what brands', 'what storage', 'available options',
        'which versions', 'what types', 'which ones do you have'
    ],
    parameters: {
        facet_target: {
            type: 'string',
            required: true,
            description: 'The internal attribute code or name being queried (e.g., "color", "storage")'
        },
        category: {
            type: 'string',
            required: false,
            description: 'The category to scope the facet search'
        },
        vendor: {
            type: 'string',
            required: false,
            description: 'The vendor to scope the facet search'
        },
        product_query: {
            type: 'string',
            required: false,
            description: 'The product name or query to scope the facet search'
        },
        attributes: {
            type: 'object',
            required: false,
            description: 'Dynamic attribute filters resolved by the pipeline (e.g., { "b:i": "infinix" })'
        }
    },
    slotTags: {
        facet_target: ['[facet_target]'],
        category: ['[category]'],
        vendor: ['[vendor]'],
        product_query: ['[residual]', '[product]']
    },
    toolName: 'product.facets',
    paramMap: {
        facet_target: 'facet_target',
        category: 'category',
        vendor: 'vendor',
        product_query: 'query',
        attributes: 'attributes'
    }
};
