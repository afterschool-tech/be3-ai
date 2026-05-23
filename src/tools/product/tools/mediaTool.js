const stateManager = require('../../../state/stateManager');
const { buildProductCards } = require('../../../utils/storefrontWhatsAppUx');
const searchToolModule = require('./searchTool');

const showCardsTool = {
    description: 'Internal utility tool to render product cards from an active state snapshot',
    params: {
        snapshot_id: { type: 'string', description: 'The snapshot ID for the cached products' }
    },
    handler: async (params, context) => {
        const { snapshot_id } = params;

        let cachedProducts = [];
        try {
            // Try targeted snapshot first
            const snap = await stateManager.getSearchSnapshot(context.sessionId, snapshot_id);
            const resultsFromSnap = snap?.filters?.results || snap?.results;
            if (Array.isArray(resultsFromSnap) && resultsFromSnap.length > 0) {
                cachedProducts = resultsFromSnap;
            } else {
                // Fallback to active state
                const state = await stateManager.getState(context.sessionId);
                const lastSearch = state?.product_context?.last_search?.results;
                if (Array.isArray(lastSearch) && lastSearch.length > 0) {
                    cachedProducts = lastSearch;
                }
            }
        } catch (e) { }

        if (cachedProducts.length === 0) {
            return { error: "Could not retrieve the product cards because the session context expired." };
        }

        const cardsPayload = buildProductCards(cachedProducts.filter(Boolean));

        return {
            directResponse: true,
            message: "Here are the details for the products:",
            whatsapp_product_cards: cardsPayload.cards.length > 0 ? { type: 'button', transaction: 'product_card', cards: cardsPayload.cards } : undefined
        };
    }
};

const getImageTool = {
    description: 'Retrieve images for products. Use this when the user specifically asks to see photos, pictures, or images.',
    params: {
        query: { type: 'string', description: 'Search keywords' },
        category: { type: 'string', description: 'Category name or slug' },
        price_min: { type: 'number', description: 'Minimum price' },
        price_max: { type: 'number', description: 'Maximum price' },
        limit: { type: 'number', description: 'Max results (default 5)' },
        sort: { type: 'string', description: 'price_asc, price_desc, date_desc, relevance' },
        tag: { type: 'string', description: 'The exact vendor tag (e.g. "Tayes Home Decor"). Use this when searching for products from a specific vendor.' },
        attributes: { type: 'object', description: 'Dynamic filters like { b: "Apple", color: "Red" } using attribute codes' },
        product_id: { type: 'string', description: 'Specific product ID if known' }
    },
    handler: async (params, context) => {
        const searchResult = await searchToolModule['product.search'].handler({
            ...params,
            limit: params.limit || 5
        }, context);

        if (searchResult.error) return searchResult;

        const strippedProducts = (searchResult.products || []).map(p => ({
            id: p.id,
            name: p.name,
            price: p.price,
            content_type: 'product'
        }));

        if (strippedProducts.length === 0) {
            return { message: "I couldn't find any images matching that description." };
        }

        return {
            message: `Here are the images for "${params.query || 'your request'}":`,
            products: strippedProducts,
            instruction: "Display these images to the user. Do not generate detailed descriptions."
        };
    }
};

module.exports = {
    'product.showCards': showCardsTool,
    'product.getImage': getImageTool
};
