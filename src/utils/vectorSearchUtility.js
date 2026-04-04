const { callBackendAPI } = require('./apiClient');

/**
 * Executes a pure vector search against the backend via unified /search.
 * @param {string} query - The search keywords
 * @param {number} limit - Max results
 * @param {string} categoryId - Optional category ID
 * @param {Object} extraParams - Optional additional filters (price_max, attributes, etc.)
 * @returns {Promise<Object|null>}
 */
async function performVectorSearch(query, limit = 5, categoryId = null, extraParams = {}) {
    if (!query) return null;

    try {
        console.log(`[VectorSearchUtil] Executing unified vector search for: "${query}"`);
        const params = new URLSearchParams({
            q: query,
            per_page: limit,
            mode: 'vector'
        });
        if (categoryId) params.append('category_id', categoryId);

        // Append extra filters
        if (extraParams) {
            Object.entries(extraParams).forEach(([k, v]) => {
                if (v !== undefined && v !== null) {
                    if (typeof v === 'object') {
                        // For attributes, we need to prefix with attribute.
                        if (k === 'attributes') {
                            Object.entries(v).forEach(([ak, av]) => params.append(`attribute.${ak}`, av));
                        }
                    } else {
                        params.append(k, v);
                    }
                }
            });
        }

        const result = await callBackendAPI(`/search?${params.toString()}`);

        if (result.success && result.data) {
            return {
                products: result.data.results || [],
                total: result.data.pagination?.total || 0,
                facets: result.data.facets || {},
                pagination: result.data.pagination || {
                    total: result.data.total || 0,
                    page: 1,
                    perPage: limit
                }
            };
        }
    } catch (e) {
        console.warn(`[VectorSearchUtil] Vector search failed: ${e.message}`);
    }

    return null;
}

/**
 * Executes a "find similar" search against the backend via unified /search.
 * @param {string} productId - The source product ID
 * @param {number} limit - Max results
 * @param {Object} extraParams - Optional additional filters
 * @returns {Promise<Object|null>}
 */
async function performSimilarSearch(productId, limit = 5, extraParams = {}) {
    if (!productId) return null;

    try {
        console.log(`[VectorSearchUtil] Executing unified similar search for product: ${productId}`);
        const params = new URLSearchParams({
            similar_to: productId,
            per_page: limit,
            mode: 'similar'
        });

        // Append extra filters
        if (extraParams) {
            Object.entries(extraParams).forEach(([k, v]) => {
                if (v !== undefined && v !== null) {
                    if (typeof v === 'object') {
                        if (k === 'attributes') {
                            Object.entries(v).forEach(([ak, av]) => params.append(`attribute.${ak}`, av));
                        }
                    } else {
                        params.append(k, v);
                    }
                }
            });
        }

        const result = await callBackendAPI(`/search?${params.toString()}`);

        if (result.success && result.data) {
            return {
                products: result.data.results || [],
                total: result.data.pagination?.total || 0,
                facets: result.data.facets || {},
                pagination: result.data.pagination || {
                    total: result.data.total || 0,
                    page: 1,
                    perPage: limit
                }
            };
        }
    } catch (e) {
        console.warn(`[VectorSearchUtil] Similar search failed: ${e.message}`);
    }

    return null;
}

/**
 * Executes an image search against the backend via unified /search.
 * @param {string} base64Image - The image data (Base64)
 * @param {number} limit - Max results
 * @param {string} categoryId - Optional category ID
 * @param {Object} extraParams - Optional additional filters
 * @returns {Promise<Object|null>}
 */
async function performImageSearch(base64Image, limit = 5, categoryId = null, extraParams = {}) {
    if (!base64Image) return null;

    try {
        console.log(`[VectorSearchUtil] Executing unified image search (base64 length: ${base64Image.length})`);
        const body = {
            image: base64Image,
            per_page: limit,
            mode: 'image'
        };

        if (categoryId) body.category_id = categoryId;

        if (extraParams) {
            Object.entries(extraParams).forEach(([k, v]) => {
                if (v !== undefined && v !== null) {
                    if (k === 'attributes' && typeof v === 'object') {
                        Object.entries(v).forEach(([ak, av]) => {
                            body[`attribute.${ak}`] = av;
                        });
                    } else {
                        body[k] = v;
                    }
                }
            });
        }

        const result = await callBackendAPI('/search', {
            method: 'POST',
            data: body // axios uses data for body
        });

        if (result.success && result.data) {
            return {
                products: result.data.results || [],
                total: result.data.pagination?.total || 0,
                facets: result.data.facets || {},
                pagination: result.data.pagination || {
                    total: result.data.total || 0,
                    page: 1,
                    perPage: limit
                }
            };
        }
    } catch (e) {
        console.warn(`[VectorSearchUtil] Image search failed: ${e.message}`);
    }

    return null;
}

module.exports = {
    performVectorSearch,
    performSimilarSearch,
    performImageSearch
};
