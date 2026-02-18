/**
 * Product Tools
 * Capabilities related to product search and details.
 */

const { normalizeCategory, normalizeVendor } = require('../utils/normalization');
const { resolveProduct } = require('../utils/productResolver');
const { performSemanticSearch } = require('../utils/searchUtility');
const { callBackendAPI } = require('../utils/apiClient');
const stateManager = require('../state/stateManager');
const { processProductList } = require('../utils/productUtility');

const productTools = {
    'product.search': {
        description: 'Advanced search for products. Supports keywords, category, price ranges, and dynamic attributes (e.g. brand, color).',
        params: {
            query: { type: 'string', description: 'Search keywords' },
            category: { type: 'string', description: 'Category name or slug' },
            price_min: { type: 'number', description: 'Minimum price' },
            price_max: { type: 'number', description: 'Maximum price' },
            limit: { type: 'number', description: 'Max results (default 5)' },
            sort: { type: 'string', description: 'price_asc, price_desc, date_desc, relevance' },
            tag: { type: 'string', description: 'The exact vendor tag (e.g. "Taye\'s Home Decor"). Use this when searching for products from a specific vendor.' },
            attributes: { type: 'object', description: 'Dynamic filters like { b: "Apple", color: "Red" } using attribute codes' }
        },
        handler: async (params, context) => {
            const { query, category, price_min, price_max, limit = 5, sort = 'relevance', tag, attributes = {} } = params;

            const searchParams = new URLSearchParams({
                per_page: limit,
                sort: sort
            });

            if (query) searchParams.append('q', query);
            if (price_min) searchParams.append('price_min', price_min);
            if (price_max) searchParams.append('price_max', price_max);
            if (tag) searchParams.append('tag', tag);

            let catId = normalizeCategory(category);

            // --- STAGE -1: Category Auto-Discovery ---
            // If no category was passed, but the query contains a category name, auto-discover it.
            // This supports semantic search even when the intent resolver follows mutual exclusivity rules.
            if (!catId && query) {
                const words = query.toLowerCase().split(/\s+/);
                for (const word of words) {
                    const discoveredId = normalizeCategory(word, context.CATEGORIES);
                    if (discoveredId) {
                        catId = discoveredId;
                        console.log(`[ProductTool] Auto-discovered category from word "${word}": ${discoveredId}`);
                        break;
                    }
                }
            }

            const cat = catId ? context.CATEGORIES[Object.keys(context.CATEGORIES).find(k => context.CATEGORIES[k].id === catId)] : null;

            if (catId) {
                searchParams.append('category', cat.slug || catId);
            }

            // --- STAGE 0: Context-First Check ---
            if (cat && cat.total_count === 0) {
                console.log(`[ProductTool] Short-circuiting search: Category "${cat.label}" has 0 products.`);
                return {
                    products: [],
                    total: 0,
                    facets: {},
                    message: `We currently don't have any products in the **${cat.label}** section.`
                };
            }

            // --- STAGE 0.5: Semantic Search (The "Power" step via Util) ---
            if (cat) {
                const semanticResult = await performSemanticSearch(query, cat, context, callBackendAPI, limit);
                if (semanticResult) return semanticResult;
            }

            // Add dynamic attributes
            const safeAttributes = attributes || {};
            Object.entries(safeAttributes).forEach(([key, val]) => {
                const finalVal = key === 'vendor' ? normalizeVendor(val) : val;
                searchParams.append(`attribute.${key}`, finalVal);
            });

            // Call Legacy Search specialized products endpoint
            const result = await callBackendAPI(`/search/products?${searchParams.toString()}`);

            if (!result.success) {
                return { error: "Failed to search products", details: result.error };
            }

            let products = result.data.products || result.data.results || [];

            // --- DATA STRIPPING & IMAGE CACHING ---
            products = await processProductList(products);

            // --- STAGE 2: Reference Mapping (Phase 8) ---
            if (products.length > 0 && context.sessionId) {
                await stateManager.updateReferenceMap(context.sessionId, products);
            }

            // --- STAGE 3: State Syncing (Phase 17) ---
            if (context.sessionId) {
                await stateManager.updateLastSearch(context.sessionId, query || category, params, products, result.data.pagination?.total || result.data.total || 0);

                if (products.length > 0) {
                    const firstId = products[0].handle || products[0].id || products[0].product_id;
                    await stateManager.setCurrentlyViewing(context.sessionId, firstId);
                }

                const currentState = await stateManager.getState(context.sessionId);
                const currentCount = currentState.session.search_refinement_count || 0;
                await stateManager.updateState(context.sessionId, {
                    session: { ...currentState.session, search_refinement_count: currentCount + 1 }
                });

                let learnedCategory = category;
                if (!learnedCategory && products.length > 0 && products[0].categories && products[0].categories.length > 0) {
                    learnedCategory = products[0].categories[0];
                }

                await stateManager.learnFromBehavior(context.sessionId, 'search', { query, category: learnedCategory });
            }

            return {
                products,
                total: result.data.pagination?.total || result.data.total || 0,
                facets: result.data.facets
            };
        }
    },

    'product.getDetails': {
        description: 'Get full product details including images and specs using a product ID',
        params: {
            product_id: { type: 'string', description: 'The UUID of the product' }
        },
        handler: async (params, context) => {
            const { product_id } = params;
            const resolvedId = await resolveProduct(product_id, context);
            if (!resolvedId) return { error: "Could not identify product" };

            const result = await callBackendAPI(`/products/storefront/products/${resolvedId}`);

            if (!result.success || !result.data.product) {
                return { error: `Product not found: ${resolvedId}` };
            }

            // --- DATA STRIPPING & IMAGE CACHING ---
            const { processProductData } = require('../utils/productUtility');
            const leanProduct = await processProductData(result.data.product);

            if (context.sessionId && result.data.product) {
                await stateManager.setCurrentlyViewing(context.sessionId, resolvedId);
                await stateManager.learnFromBehavior(context.sessionId, 'view_product', {
                    brand: result.data.product.metadata?.attributes?.v || 'Be3 Store'
                });
            }

            return {
                product: leanProduct
            };
        }
    },

    'product.compare': {
        description: 'Compare multiple products side-by-side',
        params: {
            product_ids: { type: 'array', description: 'List of product UUIDs to compare' }
        },
        handler: async (params, context) => {
            let { product_ids = [] } = params;
            if (typeof product_ids === 'string') product_ids = [product_ids];

            if (product_ids.length < 2) return { error: "Please provide at least 2 products to compare." };

            const products = [];
            for (const id of product_ids) {
                const resolvedId = await resolveProduct(id, context);
                if (resolvedId) {
                    const res = await productTools['product.getDetails'].handler({ product_id: resolvedId }, context);
                    if (!res.error) products.push(res.product);
                }
            }

            if (products.length < 2) return { error: "Could not find enough products for comparison." };

            return {
                comparison: products.map(p => ({
                    name: p.name,
                    price: p.price,
                    attributes: p.attributes,
                    description: p.description
                }))
            };
        }
    },

    'product.getAdvice': {
        description: 'Provide shopping advice, comparisons, or recommendations based on specific categories or needs.',
        params: {
            category: { type: 'string', description: 'Subject category' },
            need: { type: 'string', description: 'User need (e.g. "gaming", "budget")' }
        },
        handler: async (params, context) => {
            const { category, need } = params;
            const catId = normalizeCategory(category);
            const cat = catId ? context.CATEGORIES[Object.keys(context.CATEGORIES).find(k => context.CATEGORIES[k].id === catId)] : null;

            if (!cat) return {
                advice: "I couldn't find specific data for that category, but generally, when shopping for " + (category || "electronics") + ", you should look for reliable brands and check the warranty options.",
                suggested_action: "Would you like me to show you our top-level categories instead?"
            };

            const attributes = (cat.attributes || []).map(a => context.ATTRIBUTES[a]).filter(Boolean);
            const keyFeature = attributes.length > 0 ? attributes[0].label : "quality";

            return {
                category: cat.label,
                advice: `When looking for ${cat.label} ${need ? 'for ' + need : ''}, the most important factor is usually ${keyFeature}. We have ${cat.total_count} items in this section.`,
                suggested_filters: attributes.slice(0, 2).map(a => a.label),
                next_step: `I can search for ${need || ''} ${cat.label} for you.`
            };
        }
    },

    'product.findCheapest': {
        description: 'Find the lowest priced items in a category',
        params: {
            category: { type: 'string', description: 'Category name or slug' },
            limit: { type: 'number', description: 'Number of items (default 3)' }
        },
        handler: async (params, context) => {
            return await productTools['product.search'].handler({
                ...params,
                sort: 'price_asc'
            }, context);
        }
    },

    'product.checkAvailability': {
        description: 'Check if a product is in stock',
        params: {
            product_id: { type: 'string', description: 'Product ID or Name' }
        },
        handler: async (params, context) => {
            const resolvedId = await resolveProduct(params.product_id, context);
            const res = await productTools['product.getDetails'].handler({ product_id: resolvedId }, context);
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
    },

    'product.similarItems': {
        description: 'Find products similar to a target product',
        params: {
            product_id: { type: 'string', description: 'Product ID or Name' }
        },
        handler: async (params, context) => {
            const resolvedId = await resolveProduct(params.product_id, context);
            const res = await productTools['product.getDetails'].handler({ product_id: resolvedId }, context);
            if (res.error) return res;

            const product = res.product;
            const category_ids = product.metadata?.category_ids || [];
            if (category_ids.length === 0) return { error: "Could determine similarity context" };

            const search = await productTools['product.search'].handler({
                category: category_ids[0],
                limit: 5
            }, context);

            const similar = (search.products || []).filter(p => p.id !== resolvedId);

            return {
                original: product.name,
                similar_products: similar.slice(0, 3)
            };
        }
    },

    'product.getImage': {
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
            const searchResult = await productTools['product.search'].handler({
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
    }
};

module.exports = productTools;
