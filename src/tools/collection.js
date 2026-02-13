/**
 * Collection Tools
 * Capabilities related to product collections (e.g. New Arrivals, Best Sellers).
 */

const axios = require('axios');
const { COLLECTIONS } = require('../context/storeContext');

// Configuration
const BACKEND_URL = process.env.BACKEND_API_URL || 'http://localhost:3000';
const TENANT_ID = process.env.TENANT_ID || 'cbe1df05-45ed-455a-9ce6-156b0bd45713';

async function callBackendAPI(endpoint, options = {}) {
    try {
        const config = {
            ...options,
            headers: {
                'X-Tenant-ID': TENANT_ID,
                'Content-Type': 'application/json',
                ...options.headers
            }
        };
        const url = `${BACKEND_URL}${endpoint}`;
        console.log(`[CollectionTool] API Call: ${url}`);
        const response = await axios({ url, ...config });
        return { success: true, data: response.data };
    } catch (error) {
        if (error.code === 'ECONNREFUSED') {
            throw new Error(`connect ECONNREFUSED ${error.address}:${error.port}`);
        }
        console.error(`[CollectionTool] API Error: ${error.message}`);
        return { success: false, error: error.message };
    }
}

const collectionTools = {
    'collection.list': {
        description: 'List available product collections (e.g. New Arrivals, Best Sellers)',
        params: {},
        handler: async (params, context) => {
            // Use context first if available
            if (COLLECTIONS && Object.keys(COLLECTIONS).length > 0) {
                const collections = Object.values(COLLECTIONS).map(c => ({
                    id: c.id,
                    title: c.title,
                    slug: c.slug,
                    description: c.description || '',
                    product_count: c.product_count || 0
                }));
                return { collections, source: 'context' };
            }

            // Fallback to API
            const result = await callBackendAPI('/collections');
            if (!result.success) return { error: "Failed to retrieve collections", details: result.error };

            return {
                collections: result.data.collections || [],
                source: 'api'
            };
        }
    },

    'collection.getProducts': {
        description: 'Get products from a specific collection',
        params: {
            collection_slug: { type: 'string', description: 'Slug of the collection (e.g. new-arrivals)' },
            limit: { type: 'number', description: 'Max products to return (default 10)' }
        },
        handler: async (params, context) => {
            const { collection_slug, limit = 10 } = params;

            if (!collection_slug) return { error: "Collection slug is required" };

            // Find collection ID from context logic if needed, but API usually accepts slug
            // or we might need to look it up.

            const result = await callBackendAPI(`/collections/${collection_slug}/products?limit=${limit}`);

            if (!result.success) {
                // Try finding by ID if slug failed and we have context
                const col = Object.values(COLLECTIONS).find(c => c.slug === collection_slug);
                if (col) {
                    const retryResult = await callBackendAPI(`/collections/${col.id}/products?limit=${limit}`);
                    if (retryResult.success) {
                        return {
                            collection: col.title,
                            products: retryResult.data.products || [],
                            total: retryResult.data.pagination?.total || 0
                        };
                    }
                }
                return { error: `Collection not found or empty: ${collection_slug}` };
            }

            return {
                collection: result.data.collection?.title || collection_slug,
                products: result.data.products || [],
                total: result.data.pagination?.total || 0
            };
        }
    },

    'collection.getInfo': {
        description: 'Get detailed rules and info about a collection',
        params: {
            collection_slug: { type: 'string', description: 'Slug of the collection' }
        },
        handler: async (params, context) => {
            const col = Object.values(COLLECTIONS).find(c => c.slug === params.collection_slug);
            if (!col) return { error: "Collection not found" };

            return {
                title: col.title,
                slug: col.slug,
                description: col.description,
                rules: col.allowed_clauses || [],
                product_count: col.product_count
            };
        }
    },

    'collection.findByCategory': {
        description: 'Find collections that contain a specific category',
        params: {
            category_slug: { type: 'string', description: 'Category slug' }
        },
        handler: async (params, context) => {
            // Find categories in context to check if they are part of any collection rules
            const slug = params.category_slug.toLowerCase();
            const results = Object.values(COLLECTIONS).filter(col => {
                const rules = col.allowed_clauses || [];
                return rules.some(r => r.includes(slug));
            });

            return {
                category: params.category_slug,
                matching_collections: results.map(r => ({ title: r.title, slug: r.slug }))
            };
        }
    }
};

module.exports = collectionTools;
