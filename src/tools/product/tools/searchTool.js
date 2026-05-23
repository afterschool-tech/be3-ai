const { executeSearchStrategy } = require('../services/searchStrategyService');

const searchTool = {
    description: 'Advanced search for products. Supports keywords, category, price ranges, and dynamic attributes (e.g. brand, color).',
    params: {
        query: { type: 'string', description: 'Search keywords' },
        category: { type: 'string', description: 'Category name or slug' },
        is_kickstart: { type: 'boolean', description: 'Internal: semantic kickstart fallback mode' },
        is_partial_match: { type: 'boolean', description: 'Internal: tentative category match from internal substring' },
        price_min: { type: 'number', description: 'Minimum price' },
        price_max: { type: 'number', description: 'Maximum price' },
        limit: { type: 'number', description: 'Max results (default 5)' },
        page: { type: 'number', description: 'Pagination page (1-indexed, default 1)' },
        sort: { type: 'string', description: 'price_asc, price_desc, date_desc, relevance' },
        tag: { type: 'string', description: 'The exact vendor tag (e.g. "Taye\'s Home Decor"). Use this when searching for products from a specific vendor.' },
        attributes: { type: 'object', description: 'Dynamic filters like { b: "Apple", color: "Red" } using attribute codes' },
        search_mode: { type: 'string', description: 'The search mode to use. Set to "VECTOR" for pure semantic search.' },
        similar_to: { type: 'string', description: 'The Product ID or Handle to find products similar to.' },
        image: { type: 'string', description: 'Base64 encoded image data for visual search' },
        clause_words: { type: 'list', description: 'Internal: detected semantic clauses for labeling' },
        allow_deep_fallbacks: { type: 'boolean', description: 'Internal: if true, allows dropping filters to find suggestions' }
    },
    handler: async (params, context) => {
        return await executeSearchStrategy(params, context);
    }
};

const findCheapestTool = {
    description: 'Find the lowest priced items in a category',
    params: {
        category: { type: 'string', description: 'Category name or slug' },
        limit: { type: 'number', description: 'Number of items (default 3)' }
    },
    handler: async (params, context) => {
        return await executeSearchStrategy({
            ...params,
            sort: 'price_asc'
        }, context);
    }
};

module.exports = {
    'product.search': searchTool,
    'product.findCheapest': findCheapestTool
};
