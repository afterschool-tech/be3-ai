/**
 * Product Resolver Utility
 * Handles mapping of conversational references and names to canonical product IDs.
 */

const { callBackendAPI } = require('./apiClient');
const stateManager = require('../state/stateManager');

/**
 * Resolves a product identifier (ID, name, or reference) to a canonical Product ID/Handle.
 * @param {string} identifier - The user-provided identifier.
 * @param {object} context - Request context containing sessionId and other metadata.
 * @returns {Promise<string|null>} - The resolved canonical ID or null.
 */
async function resolveProduct(identifier, context) {
    if (!identifier) return null;
    const { sessionId } = context;

    // 1. Check if it's already a UUID/Handle (Simple check)
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier);
    if (isUuid) return identifier;

    // 2. Try to resolve reference from state (e.g., "the first one", "it")
    if (sessionId) {
        try {
            const resolvedId = await stateManager.resolveReference(sessionId, identifier);
            // Ensure resolvedId is actually somewhat valid (UUID or handle)
            if (resolvedId && (resolvedId.length > 5 || resolvedId.includes('-'))) {
                console.log(`[ProductResolver] Resolved "${identifier}" via state: ${resolvedId}`);
                return resolvedId;
            }
        } catch (e) {
            console.warn(`[ProductResolver] State resolution failed: ${e.message}`);
        }
    }

    // 3. Fallback: Search by name to find the best ID match
    try {
        const searchParams = new URLSearchParams({
            q: identifier,
            per_page: '1'
        });

        const result = await callBackendAPI(`/search/products?${searchParams.toString()}`);

        const products = result.data?.products || result.data?.results || [];
        if (products.length > 0) {
            const resolvedId = products[0].id;
            console.log(`[ProductResolver] Resolved "${identifier}" via search fallback: ${resolvedId}`);
            return resolvedId;
        }
    } catch (e) {
        console.error(`[ProductResolver] Search fallback failed: ${e.message}`);
    }

    // Return identifier as last resort (might be a handle)
    return identifier;
}

module.exports = {
    resolveProduct
};
