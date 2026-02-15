/**
 * Product Tools
 * Capabilities related to product search and details.
 */

const { normalizeCategory, normalizeVendor } = require('../utils/normalization');
const { resolveProduct } = require('../utils/productResolver');
const { performSemanticSearch } = require('../utils/searchUtility');
const { callBackendAPI } = require('../utils/apiClient');

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
            tag: { type: 'string', description: 'The exact vendor tag (e.g. "Tayes Home Decor"). Use this when searching for products from a specific vendor.' },
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

            const catId = normalizeCategory(category);
            const cat = catId ? context.CATEGORIES[Object.keys(context.CATEGORIES).find(k => context.CATEGORIES[k].id === catId)] : null;

            if (catId) {
                searchParams.append('category', cat.slug || catId);
            }

            // --- STAGE 0: Semantic Search (The "Power" step via Util) ---
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
            const stateManager = require('../state/stateManager');

            // Helper to strip data
            const stripProductData = async (product) => {
                console.log("product data response: ", JSON.stringify(product, null, 2));

                const imageUrl = product.image_url || product.metadata?.image_url;
                const productId = product.id;

                // Cache image (await to ensure it's ready for reinjection)
                if (imageUrl) {
                    try {
                        await stateManager.cacheProductImage(productId, imageUrl);
                    } catch (e) {
                        console.error('Failed to cache image:', e);
                    }
                }

                // Create lean object
                const leanProduct = {
                    id: product.id,
                    content_type: product.content_type || 'product',
                    title: product.title || product.name,
                    name: product.name || product.title,
                    description: product.description,
                    price: product.price,
                    metadata: {
                        ...product.metadata,
                        image_url: undefined, // Strip from metadata
                        description: undefined, // Strip redundant description
                        search_vector: undefined, // Strip internal vector
                        keywords: undefined // Strip keywords
                    },
                    // Explicitly remove top-level heavy fields
                    image_url: undefined,
                    search_vector: undefined,
                    keywords: undefined
                };

                // Clean up metadata further if needed
                if (leanProduct.metadata) {
                    delete leanProduct.metadata.image_url;
                    delete leanProduct.metadata.search_vector;
                }

                console.log("product data after stripping: ", JSON.stringify(leanProduct, null, 2));
                return leanProduct;
            };

            // Process all products
            products = await Promise.all(products.map(stripProductData));

            // --- STAGE 2: Reference Mapping (Phase 8) ---
            // Ensure products are in the state reference map so AI can say "add the first one" or "add it"
            if (products.length > 0 && context.sessionId) {
                await stateManager.updateReferenceMap(context.sessionId, products);
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

            return {
                product: result.data.product
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
            return {
                name: p.name,
                in_stock: stock > 0,
                quantity: stock,
                status: stock > 0 ? 'Available' : 'Out of stock'
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

            // Search in the same category
            const search = await productTools['product.search'].handler({
                category: category_ids[0],
                limit: 5
            }, context);

            const similar = (search.data || []).filter(p => p.id !== resolvedId);

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
            // Reuse product.search logic with ALL params
            const searchResult = await productTools['product.search'].handler({
                ...params,
                limit: params.limit || 5 // Default limit for images
            }, context);

            if (searchResult.error) return searchResult;

            // Strict stripping: Keep only ID, name, price
            const strippedProducts = (searchResult.products || []).map(p => ({
                id: p.id,
                name: p.name,
                price: p.price,
                content_type: 'product' // Required for imageInjector
            }));

            // Check if we found anything
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
