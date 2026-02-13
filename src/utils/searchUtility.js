const { CLAUSES } = require('../context/clauses');
const { resolveClauses } = require('./clauseResolver');
const { callBackendAPI } = require('./apiClient');

/**
 * Constructs a semantic slug for the resolve-slug endpoint
 * Pattern: prefix + category_slug + suffix
 */
function constructSemanticSlug(categorySlug, clauses = []) {
    if (!categorySlug || clauses.length === 0) return null;

    // Use the first clause as the primary semantic modifier
    const clauseId = clauses[0];
    const clause = CLAUSES[clauseId];

    if (!clause) return null;

    const prefix = (clause.display?.prefix || '').toLowerCase().replace(/\s+/g, '-');
    const suffix = (clause.display?.suffix || '').toLowerCase().replace(/\s+/g, '-');

    return `${prefix}${categorySlug}${suffix}`;
}

/**
 * Executes a full semantic search flow:
 * 1. AI Clause Resolution
 * 2. Slug Construction
 * 3. Backend Slug Resolution (pre-fetch)
 * 4. Product Fetching
 */
async function performSemanticSearch(query, category, context, callBackendAPI, limit = 5) {
    if (!category || !category.slug) return null;

    try {
        const resolved = await resolveClauses(
            query || context.userMessage || '',
            category.id,
            context.history || []
        );

        if (resolved.clauses && resolved.clauses.length > 0) {
            const semanticSlug = constructSemanticSlug(category.slug, resolved.clauses);
            if (semanticSlug) {
                console.log(`[SearchUtil] Attempting slug resolution: ${semanticSlug}`);
                const slugResult = await callBackendAPI(`/search/resolve-slug/${semanticSlug}`);

                if (slugResult.success && slugResult.data.filter) {
                    console.log(`[SearchUtil] Slug resolved! Using filter: ${slugResult.data.filter}`);
                    const result = await callBackendAPI(`/search?${slugResult.data.filter}&per_page=${limit}`);

                    if (result.success) {
                        return {
                            products: result.data.results || [],
                            total: result.data.pagination?.total || 0,
                            facets: result.data.facets,
                            seo: slugResult.data.seo,
                            resolved_slug: semanticSlug
                        };
                    }
                }
            }
        }
    } catch (e) {
        console.warn(`[SearchUtil] Semantic search failed: ${e.message}`);
    }

    return null;
}

module.exports = {
    constructSemanticSlug,
    performSemanticSearch
};
