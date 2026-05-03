/**
 * Search Interface Client
 * 
 * HTTP client for the be3_ai backend module's search interface.
 * Builds a structured search spec from pipeline entities and executes it.
 * 
 * PRINCIPLE: All 4-stage search logic is delegated to the backend.
 * The AI pipeline only provides the classification, the backend executes.
 */

const { callBackendAPI, TENANT_ID } = require('./apiClient');

/**
 * Execute a structured search via the backend Search Interface.
 * 
 * @param {object} spec - Structured search specification
 * @param {string} spec.query - Search query
 * @param {Array} spec.categories - [{ id, slug, label, isWinner, isPartial }]
 * @param {string} spec.categoryType - 'single' | 'none' | 'multiple'
 * @param {string|null} spec.vendor - Vendor name
 * @param {object} spec.attributes - { code: value }
 * @param {object|null} spec.priceFilter - { min, max }
 * @param {number} spec.limit
 * @param {number} spec.page
 * @param {string} spec.sort
 * @returns {object} Search result with classification
 */
async function executeSearch(spec) {
    try {
        const result = await callBackendAPI('/be3-ai/search', {
            method: 'POST',
            data: {
                tenantId: TENANT_ID,
                ...spec
            }
        });

        if (result.success && result.data) {
            return result.data;
        }

        console.error('[SearchInterfaceClient] Search failed:', result.error);
        return _emptyResult();
    } catch (error) {
        console.error('[SearchInterfaceClient] Search error:', error.message);
        return _emptyResult();
    }
}

/**
 * Build a structured search spec from pipeline-extracted params.
 * Bridges the gap between what the pipeline produces and what the backend expects.
 * 
 * @param {object} params - Tool params from the pipeline
 * @param {object} bloomResult - Result from bloomClient.checkBloom()
 * @returns {object} Structured search spec
 */
function buildSearchSpec(params, bloomResult = null) {
    const spec = {
        query: params.query || '',
        categories: [],
        categoryType: params._category_type || 'none',
        attributes: params.attributes || {},
        priceFilter: null,
        limit: params.limit || 5,
        page: params.page || 1,
        sort: params.sort || 'relevance'
    };

    // Build category list from pipeline candidates
    if (params._category_candidates && Array.isArray(params._category_candidates)) {
        spec.categories = params._category_candidates;
    } else if (params.category) {
        // Legacy single-category param
        spec.categories = [{
            id: params.category,
            slug: null,
            label: null,
            isWinner: true,
            isPartial: params.is_partial_match || false
        }];
        spec.categoryType = 'single';
    }

    // Vendor is part of attributes (attributes.vendor) — no separate field needed

    // Price filter (for post-processing)
    if (params.price_min !== undefined || params.price_max !== undefined) {
        spec.priceFilter = {
            min: params.price_min ?? null,
            max: params.price_max ?? null
        };
    }

    // Partial word — the word consumed by the category scanner for partial matches.
    // When the category is dropped, this word gets restored into the query.
    if (params._category_words) {
        spec.partialWord = params._category_words;
    }

    return spec;
}

function _emptyResult() {
    return {
        products: [],
        total: 0,
        facets: {},
        classification: 'none',
        stage: 0,
        category_used: null,
        price_filter_applied: false,
        price_filter_failed: false,
        vector_fallback_needed: true,
        partialFallback: false,
        pagination: { page: 1, perPage: 5, total: 0, totalPages: 0 }
    };
}

module.exports = {
    executeSearch,
    buildSearchSpec
};
