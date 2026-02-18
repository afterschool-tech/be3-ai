/**
 * Intent: browse_collection
 * Triggered when the user wants to browse a curated collection (e.g. New Arrivals, Best Sellers).
 */

module.exports = {
    name: 'browse_collection',

    keywords: [
        'collection', 'new arrivals', 'best sellers', 'trending', 'featured'
    ],

    synonyms: [
        'show me the collection', 'browse collection', 'what is trending',
        'new products', 'latest arrivals', 'popular items',
        'what is new', "what's new", 'top picks', 'curated',
        'show me new arrivals', 'best selling', 'most popular',
        'hot items', 'fresh drops', 'newest items'
    ],

    parameters: {
        collection_slug: { type: 'string', required: true, description: 'Slug of the collection (e.g. new-arrivals, best-sellers)' },
        limit: { type: 'number', required: false, description: 'Max products to return (default 10)' }
    },

    toolName: 'collection.getProducts',

    paramMap: {
        collection_slug: 'collection_slug',
        limit: 'limit'
    },

    minProducts: 0,
    maxProducts: 0,
    invertTo: null
};
