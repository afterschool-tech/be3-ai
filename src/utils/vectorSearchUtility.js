const { callBackendAPI } = require('./apiClient');

/**
 * Executes a pure vector search against the backend via unified /search.
 * @param {string} query - The search keywords
 * @param {number} limit - Max results
 * @param {string} categoryId - Optional category ID
 * @returns {Promise<Object|null>}
 */
async function performVectorSearch(query, limit = 5, categoryId = null) {
    if (!query) return null;

    try {
        console.log(`[VectorSearchUtil] Executing unified vector search for: "${query}"`);
        const params = new URLSearchParams({
            q: query,
            per_page: limit,
            mode: 'vector'
        });
        if (categoryId) params.append('category_id', categoryId);

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
 * @returns {Promise<Object|null>}
 */
async function performSimilarSearch(productId, limit = 5) {
    if (!productId) return null;

    try {
        console.log(`[VectorSearchUtil] Executing unified similar search for product: ${productId}`);
        const params = new URLSearchParams({
            similar_to: productId,
            per_page: limit,
            mode: 'similar'
        });

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

module.exports = {
    performVectorSearch,
    performSimilarSearch
};
