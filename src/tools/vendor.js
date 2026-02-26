const { callBackendAPI } = require('../utils/apiClient');
const stateManager = require('../state/stateManager');
const { processProductList } = require('../utils/productUtility');
const {
    buildProductCards,
    buildFacetRefinerButtons,
    deriveClauseNameFromAttributes,
    pickVendorSeeMoreTitle,
    computeHasNextPage,
    createSnapshotId
} = require('../utils/storefrontWhatsAppUx');

function truncateButtonTitle(title, maxLen = 20) {
    const t = String(title || '');
    if (t.length <= maxLen) return t;
    return t.slice(0, Math.max(0, maxLen - 1)) + '…';
}

function encodeBase64Url(str) {
    return Buffer.from(String(str || ''), 'utf8')
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
}

/**
 * Internal helper to resolve vendor from name or history
 */
function resolveVendorFromContext(vendorName, context) {
    const vendors = Object.values(context.VENDORS);

    console.log('[VendorTool] resolveVendorFromContext called with:', {
        input: vendorName,
        totalVendors: vendors.length
    });

    // 1. Direct ID match
    if (vendorName) {
        const idMatch = vendors.find(v => v.id === vendorName);
        if (idMatch) {
            console.log('[VendorTool] Resolved by ID match:', {
                id: idMatch.id,
                business_name: idMatch.business_name
            });
            return idMatch;
        }
    }

    // 2. Direct name/tag match
    if (vendorName && vendorName.toLowerCase() !== 'their' && vendorName.toLowerCase() !== 'this vendor') {
        const lowerName = vendorName.toLowerCase();
        const found = vendors.find(v =>
            v.business_name.toLowerCase().includes(lowerName) ||
            v.tag.toLowerCase() === lowerName
        );
        if (found) {
            console.log('[VendorTool] Resolved by name/tag match:', {
                input: vendorName,
                business_name: found.business_name,
                tag: found.tag
            });
            return found;
        }
    }

    // 3. Resolve from history (e.g. "their products")
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

    console.log('[VendorTool] Failed to resolve vendor from context for input:', vendorName);
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
            limit: { type: 'number', description: 'Max products to return (default 5)' },
            page: { type: 'number', description: 'Pagination page (1-indexed, default 1)' },
            sort: { type: 'string', description: 'price_asc, price_desc, date_desc, relevance' },
            attributes: { type: 'object', description: 'Dynamic filters like { b: "Apple", color: "Red" } using attribute codes' }
        },
        handler: async (params, context) => {
            // Tool registry sometimes passes "vendor_name" instead of "vendor".
            const vendorName = params.vendor || params.vendor_name;
            const { limit = 5, page = 1, sort = 'relevance', attributes = {} } = params;

            const vendor = resolveVendorFromContext(vendorName, context);
            if (!vendor) return { error: `Vendor "${vendorName}" not found.` };

            const vendorTag = vendor.tag || vendor.business_name;
            if (!vendorTag) {
                return { error: `Vendor "${vendorName}" has no tag.` };
            }

            const snapshotId = createSnapshotId();
            try {
                if (context.sessionId) {
                    // Store a snapshot compatible with __nav:more:<snapshotId>__ → product.search paging.
                    await stateManager.setSearchSnapshot(context.sessionId, snapshotId, {
                        query: null,
                        category: null,
                        price_min: null,
                        price_max: null,
                        limit,
                        page,
                        sort,
                        tag: vendorTag,
                        attributes
                    });
                }
            } catch (_) {}

            const searchQuery = new URLSearchParams({
                per_page: limit,
                page: page,
                sort: sort
            });
            searchQuery.append('tag', vendorTag);
            searchQuery.append('type', 'product');

            const safeAttributes = attributes || {};
            Object.entries(safeAttributes).forEach(([key, val]) => {
                if (val === undefined || val === null) return;
                searchQuery.append(`attribute.${key}`, val);
            });

            const result = await callBackendAPI(`/search?${searchQuery.toString()}`);
            if (!result?.success) {
                return { error: `Failed to fetch products for vendor "${vendor.business_name}"`, details: result?.error };
            }

            let rawProducts = result.data.products || result.data.results || [];
            let products = await processProductList(rawProducts);
            if (context.sessionId) {
                const scope = context && context.microstate_active ? 'microstate' : 'global';
                await stateManager.updateReferenceMap(context.sessionId, products, { scope });
            }

            const hasNextPage = computeHasNextPage({
                pagination: result?.data?.pagination,
                fallbackCount: result?.data?.total || products.length,
                page,
                limit
            });

            const { clauseButtons, valueButtons } = buildFacetRefinerButtons({
                facets: result?.data?.facets,
                attributes,
                snapshotId
            });

            const clauseName = deriveClauseNameFromAttributes(attributes);

            const globalButtons = [];
            if (hasNextPage) {
                const titleBase = pickVendorSeeMoreTitle(vendor.business_name || vendor.tag);
                const seeMoreTitle = truncateButtonTitle(titleBase || 'See more');
                globalButtons.push({
                    id: `__nav:more:${snapshotId}__`,
                    title: seeMoreTitle || 'See more',
                    priority: 100
                });
            }

            const refiners = [...clauseButtons, ...valueButtons];
            if (refiners.length > 0) globalButtons.push(...refiners);

            const cardsPayload = buildProductCards(products);

            return {
                vendor: vendor.business_name,
                method: 'search',
                products,
                total: result.data.pagination?.total || result.data.total || products.length,
                facets: result.data.facets,
                whatsapp_product_cards: (Array.isArray(cardsPayload?.cards) && cardsPayload.cards.length > 0)
                    ? cardsPayload
                    : undefined,
                whatsapp: (globalButtons.length > 0)
                    ? { type: 'button', buttons: globalButtons }
                    : undefined
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

            const vendorKeyRaw = vendor.tag || vendor.business_name || vendor.id;
            const vendorKey = vendorKeyRaw ? encodeBase64Url(vendorKeyRaw) : '';
            const contactTitle = truncateButtonTitle(`Contact ${vendor.business_name || vendor.tag || 'vendor'}`);

            return {
                message: `Here’s information about **${vendor.business_name || vendor.tag || 'this vendor'}**.`,
                vendor,
                whatsapp: {
                    type: 'button',
                    buttons: [
                        { id: `__vendor:products:${vendorKey}__`, title: 'See products' },
                        { id: `__vendor:contact:${vendorKey}__`, title: contactTitle }
                    ]
                }
            };
        }
    },
    'vendor.getContactLink': {
        description: 'Generate a WhatsApp contact link for a vendor. CRITICAL: If the user wants to "send a message", "tell them", or "feedback", you MUST provide the `message` parameter with the exact text they want to send.',
        params: {
            vendor: { type: 'string', description: 'Vendor name or tag' },
            message: { type: 'string', description: 'The exact message content to pre-fill (e.g. "I loved your last product"). Required if user wants to send specific text.' }
        },
        handler: async (params, context) => {
            // Tool registry sometimes passes "vendor_name" instead of "vendor".
            const vendorName = params.vendor || params.vendor_name;
            const message = params.message;
            console.log('[VendorTool] vendor.getContactLink called with params:', params, 'resolved vendorName:', vendorName);
            const vendor = resolveVendorFromContext(vendorName, context);
            if (!vendor) {
                console.log('[VendorTool] vendor.getContactLink: vendor not found for input:', vendorName);
                return { error: 'Vendor not found' };
            }

            if (!vendor.whatsapp_phone) {
                console.log('[VendorTool] vendor.getContactLink: vendor has no whatsapp_phone:', vendor.business_name);
                return { error: `Vendor ${vendor.business_name} does not have a WhatsApp number registered.` };
            }

            const phone = vendor.whatsapp_phone.replace(/\+/g, '').replace(/\s+/g, '');
            let link = `https://wa.me/${phone}`;
            if (message) {
                link += `?text=${encodeURIComponent(message)}`;
            }

            console.log('[VendorTool] vendor.getContactLink: success building link:', {
                vendor: vendor.business_name,
                phone: vendor.whatsapp_phone,
                link
            });

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
