const { callBackendAPI } = require('../utils/apiClient');

/**
 * Internal helper to resolve vendor from name or history
 */
function resolveVendorFromContext(vendorName, context) {
    const vendors = Object.values(context.VENDORS);

    // 1. Direct name match
    if (vendorName && vendorName.toLowerCase() !== 'their' && vendorName.toLowerCase() !== 'this vendor') {
        const lowerName = vendorName.toLowerCase();
        const found = vendors.find(v =>
            v.business_name.toLowerCase().includes(lowerName) ||
            v.tag.toLowerCase() === lowerName
        );
        if (found) return found;
    }

    // 2. Resolve from history (e.g. "their products")
    if (!vendorName || vendorName.toLowerCase() === 'their' || vendorName.toLowerCase() === 'this vendor') {
        const history = context.history || [];
        // Look back for the most recent vendor mentioned in history
        for (let i = history.length - 1; i >= 0; i--) {
            const entry = history[i];
            const text = entry.text.toLowerCase();
            const found = vendors.find(v => text.includes(v.business_name.toLowerCase()));
            if (found) {
                console.log(`[VendorTool] Resolved "${vendorName}" from history as: ${found.business_name}`);
                return found;
            }
        }
    }

    return null;
}

const vendorTools = {
    'vendor.list': {
        description: 'List all available vendors in the marketplace',
        params: {},
        handler: async (params, context) => {
            return Object.values(context.VENDORS).map(v => ({
                name: v.business_name,
                tag: v.tag,
                product_count: v.product_count,
                delivery: v.delivery_scope
            }));
        }
    },

    'vendor.getProducts': {
        description: "Get products belonging to a specific vendor using multiple lookup methods (Tags, Collections, and Creator IDs). Use this when the user asks 'What does [Vendor] sell?' or 'Show me products from [Vendor]'.",
        params: {
            vendor: { type: 'string', description: 'Vendor name or "their" for current sequence' },
            limit: { type: 'number', description: 'Max products to return (default 5)' }
        },
        handler: async (params, context) => {
            const { vendor: vendorName, limit = 5 } = params;
            const vendor = resolveVendorFromContext(vendorName, context);

            if (!vendor) return { error: `Vendor "${vendorName}" not found.` };

            console.log(`[VendorTool] Fetching products for ${vendor.business_name} using 4-path lookup (Priority: Tag)`);

            // Method 1: Tag Match (tag=) - STRICTEST VENDOR FILTER
            const tagResult = await callBackendAPI(`/search/products?tag=${encodeURIComponent(vendor.tag || vendor.business_name)}&per_page=${limit}`);
            if (tagResult.success && tagResult.data.products?.length > 0) {
                const products = tagResult.data.products;
                if (context.sessionId) {
                    const stateManager = require('../state/stateManager');
                    await stateManager.updateReferenceMap(context.sessionId, products);
                }
                return {
                    vendor: vendor.business_name,
                    method: 'tag',
                    products: products,
                    total: tagResult.data.pagination?.total || products.length
                };
            }

            // Method 2: Keyword Match (q=) - Fallback for loose names
            const keywordResult = await callBackendAPI(`/search?q=${encodeURIComponent(vendor.business_name)}&per_page=${limit}`);
            if (keywordResult.success && (keywordResult.data.products?.length > 0 || keywordResult.data.results?.length > 0)) {
                const products = keywordResult.data.products || keywordResult.data.results;
                if (context.sessionId) {
                    const stateManager = require('../state/stateManager');
                    await stateManager.updateReferenceMap(context.sessionId, products);
                }
                return {
                    vendor: vendor.business_name,
                    method: 'keyword',
                    products: products,
                    total: keywordResult.data.pagination?.total || products.length
                };
            }

            // Method 2: Collection Match (Vendor named collections)
            const collKey = vendor.business_name.toLowerCase().replace(/\s+/g, '_');
            const collection = context.COLLECTIONS[collKey] || Object.values(context.COLLECTIONS).find(c => c.label.toLowerCase() === vendor.business_name.toLowerCase());

            if (collection) {
                const collResult = await callBackendAPI(`/search/products?collection=${collection.slug || collection.id}&per_page=${limit}`);
                if (collResult.success && collResult.data.products?.length > 0) {
                    const products = collResult.data.products;
                    if (context.sessionId) {
                        const stateManager = require('../state/stateManager');
                        await stateManager.updateReferenceMap(context.sessionId, products);
                    }
                    return {
                        vendor: vendor.business_name,
                        method: 'collection',
                        products: products,
                        total: collResult.data.pagination?.total || products.length
                    };
                }
            }

            // Method 3: Creator ID (Secondary fallback)
            const creatorResult = await callBackendAPI(`/search/products?created_by=${vendor.id}&per_page=${limit}`);
            if (creatorResult.success && creatorResult.data.products?.length > 0) {
                const products = creatorResult.data.products;
                if (context.sessionId) {
                    const stateManager = require('../state/stateManager');
                    await stateManager.updateReferenceMap(context.sessionId, products);
                }
                return {
                    vendor: vendor.business_name,
                    method: 'creator_id',
                    products: products,
                    total: creatorResult.data.pagination?.total || products.length
                };
            }

            return {
                vendor: vendor.business_name,
                message: "No products found for this vendor using standard lookup methods.",
                products: []
            };
        }
    },

    'vendor.checkIdentity': {
        description: 'Verify if a specific product belongs to a vendor. Use for queries like "Is this [Product] from [Vendor]?"',
        params: {
            product: { type: 'string', description: 'Product name or ID' },
            vendor: { type: 'string', description: 'Vendor name or tag' }
        },
        handler: async (params, context) => {
            const { product: productId, vendor: vendorName } = params;
            const vendor = resolveVendorFromContext(vendorName, context);
            if (!vendor) return { error: "Vendor not found" };

            // Fetch the product to check its created_by or tags
            const productResult = await callBackendAPI(`/products/storefront/products/${productId}`);
            if (!productResult.success) return { error: "Product not found" };

            const product = productResult.data.product;
            const isCreatorMatch = product.created_by === vendor.id;
            const isTagMatch = Array.isArray(product.tags) && product.tags.includes(vendor.business_name);

            return {
                belongs_to_vendor: isCreatorMatch || isTagMatch,
                details: {
                    product: product.name,
                    vendor: vendor.business_name,
                    creator_match: isCreatorMatch,
                    tag_match: isTagMatch
                }
            };
        }
    },

    'vendor.getInfo': {
        description: 'Get detailed information about a specific vendor',
        params: {
            vendor: { type: 'string', description: 'Vendor name or tag' }
        },
        handler: async (params, context) => {
            const vendor = resolveVendorFromContext(params.vendor, context);
            if (!vendor) return { error: 'Vendor not found' };
            return vendor;
        }
    },
    'vendor.getContactLink': {
        description: 'Generate a WhatsApp contact link for a vendor with an optional predefined message',
        params: {
            vendor: { type: 'string', description: 'Vendor name or tag' },
            message: { type: 'string', description: 'Optional message to pre-fill in WhatsApp' }
        },
        handler: async (params, context) => {
            const { vendor: vendorName, message } = params;
            const vendor = resolveVendorFromContext(vendorName, context);
            if (!vendor) return { error: 'Vendor not found' };

            if (!vendor.whatsapp_phone) {
                return { error: `Vendor ${vendor.business_name} does not have a WhatsApp number registered.` };
            }

            const phone = vendor.whatsapp_phone.replace(/\+/g, '').replace(/\s+/g, '');
            let link = `https://wa.me/${phone}`;
            if (message) {
                link += `?text=${encodeURIComponent(message)}`;
            }

            return {
                vendor: vendor.business_name,
                whatsapp_link: link,
                phone: vendor.whatsapp_phone,
                message_preview: message || null
            };
        }
    }
};

module.exports = vendorTools;
