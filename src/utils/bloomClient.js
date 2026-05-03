/**
 * Bloom Client
 * 
 * HTTP client for the Bloom filter backend module.
 * Used by the AI pipeline during entity extraction (Steps 1-2).
 * 
 * PRINCIPLE: Fail-open — if the Bloom service is down, all tokens "pass".
 */

const { callBackendAPI, TENANT_ID } = require('./apiClient');

/**
 * Batch check tokens against global + category Bloom filters.
 * 
 * @param {string[]} tokens - Query tokens to check
 * @param {string[]} [candidateCategories] - Category IDs to check individually
 * @returns {object} { global: { passed, hits, misses }, categories: { [catId]: { passed, hits, misses } } }
 */
async function checkBloom(tokens, candidateCategories = []) {
    try {
        const result = await callBackendAPI('/bloom/ai/check', {
            method: 'POST',
            data: {
                tenantId: TENANT_ID,
                tokens,
                candidateCategories
            }
        });

        if (result.success && result.data) {
            return result.data;
        }

        // Fail-open on API error
        return _failOpen(tokens);
    } catch (error) {
        console.warn('[BloomClient] Check failed (fail-open):', error.message);
        return _failOpen(tokens);
    }
}

/**
 * Check only global filter.
 * @param {string[]} tokens
 * @returns {{ passed: boolean, hits: string[], misses: string[] }}
 */
async function checkGlobal(tokens) {
    const result = await checkBloom(tokens, []);
    return result.global;
}

/**
 * Check tokens against specific category filters.
 * @param {string[]} tokens
 * @param {string[]} categoryIds
 * @returns {{ [catId]: { passed, hits, misses } }}
 */
async function checkCategories(tokens, categoryIds) {
    const result = await checkBloom(tokens, categoryIds);
    return result.categories;
}

/**
 * Fail-open default: assume all tokens pass.
 */
function _failOpen(tokens) {
    return {
        global: { passed: true, hits: tokens, misses: [], source: 'fail-open' },
        categories: {}
    };
}

module.exports = {
    checkBloom,
    checkGlobal,
    checkCategories
};
