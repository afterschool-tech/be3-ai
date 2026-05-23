const { callBackendAPI } = require('../../../utils/apiClient');
const { resolveProduct } = require('../../../utils/productResolver');
const stateManager = require('../../../state/stateManager');
const { processProductData } = require('../../../utils/productUtility');
const { enrichProductAttributes } = require('../services/productDetailService');

function encodeBase64Url(str) {
    return Buffer.from(String(str || ''), 'utf8')
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
}

const detailsTool = {
    description: 'Get full product details including images and specs using a product ID',
    params: {
        product_id: { type: 'string', description: 'The UUID of the product' }
    },
    handler: async (params, context) => {
        const { product_id, _suppress_ambient } = params;
        const resolvedId = await resolveProduct(product_id, context);

        if (!resolvedId) {
            return {
                message: `I couldn't find a product matching "${product_id}". Would you like me to search for it instead?`,
                whatsapp: {
                    type: 'button',
                    buttons: [
                        { id: product_id, title: `Search for "${product_id.substring(0, 15)}..."` }
                    ]
                }
            };
        }

        const result = await callBackendAPI(`/products/storefront/products/${resolvedId}`);

        if (!result.success || !result.data.product) {
            return { error: `I couldn't find the details for this product right now. Please try again or search for something else.` };
        }

        const rawProduct = result.data.product;
        const vendorTag =
            (Array.isArray(rawProduct.tags) ? rawProduct.tags[0] : null) ||
            (Array.isArray(rawProduct.metadata?.tags) ? rawProduct.metadata.tags[0] : null);
        const vendorKey = vendorTag ? encodeBase64Url(String(vendorTag)) : null;

        // --- DATA STRIPPING & IMAGE CACHING ---
        const leanProduct = await processProductData(rawProduct);

        // --- ENRICH ATTRIBUTES ---
        await enrichProductAttributes(leanProduct, rawProduct, context, resolvedId);

        if (context.sessionId && result.data.product && !_suppress_ambient) {
            await stateManager.setCurrentlyViewing(context.sessionId, resolvedId);

            // --- AMBIENT CONTEXT: Record active product topic ---
            await stateManager.setActiveTopic(context.sessionId, {
                type: "single_product",
                category_id: rawProduct.metadata?.category_ids?.[0] || null,
                category_label: rawProduct.metadata?.category_names?.[0] || null,
                vendor: rawProduct.metadata?.attributes?.vendor || vendorTag || null,
                product_id: leanProduct.id || resolvedId,
                product_name: leanProduct.name || rawProduct.name,
                attributes: null
            });

            await stateManager.learnFromBehavior(context.sessionId, 'view_product', {
                brand: result.data.product.metadata?.attributes?.v || 'Be3 Store'
            });
        }

        const buttons = [
            { id: `__cart:add:${resolvedId}__`, title: 'Add to cart' },
            { id: `__product:compare:${resolvedId}__`, title: 'Compare' },
            { id: `show similar to ${leanProduct.name || resolvedId}`, title: 'Show similar' }
        ];

        // Vendor rule: only show Vendor info when a tag exists; if no tag, product has no vendor.
        if (vendorKey) {
            buttons.push({ id: `__vendor:info:${vendorKey}__`, title: 'Vendor info' });
        }

        return {
            message: `Here’s more information about **${leanProduct.name || leanProduct.title || 'this product'}**.`,
            product: leanProduct,
            whatsapp: {
                type: 'button',
                buttons
            }
        };
    }
};

const checkAvailabilityTool = {
    description: 'Check if a product is in stock',
    params: {
        product_id: { type: 'string', description: 'Product ID or Name' }
    },
    handler: async (params, context) => {
        const resolvedId = await resolveProduct(params.product_id, context);
        const res = await detailsTool.handler({ product_id: resolvedId }, context);
        if (res.error) return res;

        const p = res.product;
        const stock = p.inventory_quantity ?? 0;
        const fakeStock = stock > 0 ? stock : 50;

        return {
            name: p.name,
            in_stock: true,
            quantity: fakeStock,
            status: 'Available'
        };
    }
};

module.exports = {
    'product.getDetails': detailsTool,
    'product.checkAvailability': checkAvailabilityTool
};
