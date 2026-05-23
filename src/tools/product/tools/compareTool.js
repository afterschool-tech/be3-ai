const { resolveProduct } = require('../../../utils/productResolver');
const stateManager = require('../../../state/stateManager');
const { loadFallbackAttributesLookup, expandAttributesForComparison } = require('../services/productDetailService');
const detailsToolModule = require('./detailsTool');
const searchToolModule = require('./searchTool');

const compareTool = {
    description: 'Compare multiple products side-by-side',
    params: {
        product_ids: { type: 'array', description: 'List of product UUIDs to compare' },
        product_segments: { type: 'array', description: 'List of product segments with localized metadata' }
    },
    handler: async (params, context) => {
        const { product_segments = [] } = params;
        let { product_ids = [] } = params;
        if (typeof product_ids === 'string') product_ids = [product_ids];

        const products = [];

        if (product_segments.length >= 2) {
            for (const seg of product_segments) {
                const identifier = seg.query;
                const constraints = {};
                if (seg.category) constraints.category = seg.category;
                if (seg.attributes?.brand) constraints.brand = seg.attributes.brand;

                const resolvedId = seg._resolved_product_id || await resolveProduct(identifier, context, constraints);
                if (resolvedId) {
                    const res = await detailsToolModule['product.getDetails'].handler({ product_id: resolvedId, _suppress_ambient: true }, context);
                    if (!res.error) products.push(res.product);
                }
            }
        } else {
            if (product_ids.length < 2) return { error: "Please provide at least 2 products to compare." };
            for (const id of product_ids) {
                const resolvedId = await resolveProduct(id, context);
                if (resolvedId) {
                    const res = await detailsToolModule['product.getDetails'].handler({ product_id: resolvedId, _suppress_ambient: true }, context);
                    if (!res.error) products.push(res.product);
                }
            }
        }

        if (products.length < 2) return { error: "Could not find enough products for comparison." };

        try {
            if (context?.sessionId) {
                const scope = context.microstate_active ? 'microstate' : 'global';
                await stateManager.updateReferenceMap(context.sessionId, products, { scope });
                await stateManager.updateLastSearch(
                    context.sessionId,
                    `Comparison: ${products.map(p => p.name || p.title || p.id).filter(Boolean).join(' vs ')}`,
                    { product_ids },
                    products,
                    products.length
                );
                const firstId = products[0]?.id || products[0]?.handle || products[0]?.product_id;
                if (firstId) await stateManager.setCurrentlyViewing(context.sessionId, firstId);

                await stateManager.setActiveTopic(context.sessionId, {
                    type: "comparison",
                    category_id: products[0]?.metadata?.category_ids?.[0] || null,
                    category_label: products[0]?.metadata?.category_names?.[0] || null,
                    vendor: null,
                    product_id: null,
                    product_name: null,
                    product_ids: products.map(p => p.id || p.handle).filter(Boolean),
                    attributes: null
                });
            }
        } catch (_) { }

        const lastSearchAttributesById = await loadFallbackAttributesLookup(context);

        return {
            comparison: products.map(p => ({
                id: p.id || null,
                name: p.name || p.title || null,
                title: p.title || p.name || null,
                price: p.price ?? null,
                vendor: p.vendor || p.metadata?.vendor || null,
                whatsapp_link: p.whatsapp_link || p.metadata?.whatsapp_link || null,
                checkout_url: p.checkout_url || p.metadata?.checkout_url || null,
                ...expandAttributesForComparison(p, lastSearchAttributesById, context),
                description: p.description || null
            }))
        };
    }
};

const similarItemsTool = {
    description: 'Find products similar to a target product',
    params: {
        product_id: { type: 'string', description: 'Product ID or Name' }
    },
    handler: async (params, context) => {
        const resolvedId = await resolveProduct(params.product_id, context);
        const res = await detailsToolModule['product.getDetails'].handler({ product_id: resolvedId }, context);
        if (res.error) return res;

        const product = res.product;
        const category_ids = product.metadata?.category_ids || [];
        if (category_ids.length === 0) return { error: "Could determine similarity context" };

        const search = await searchToolModule['product.search'].handler({
            category: category_ids[0],
            limit: 5
        }, context);

        const similar = (search.products || []).filter(p => p.id !== resolvedId);

        return {
            original: product.name,
            similar_products: similar.slice(0, 3)
        };
    }
};

module.exports = {
    'product.compare': compareTool,
    'product.similarItems': similarItemsTool
};
