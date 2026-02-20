/**
 * Pipeline Stage 4c: Context Reconciler
 * 
 * Delicate semantic reconciliation between generic category labels 
 * and specific products from the last search result.
 * 
 * Logic:
 * - If intent is Transactional (add_to_cart, product_compare)
 * - If category is present but products are missing/generic
 * - Reconcile using state.product_context.last_search
 * 
 * Signature: reconcile(intent, state, storeContext)
 */

const { logDebug } = require('../../../utils/debugLogger');

function reconcile(intent, state, storeContext) {
    if (!intent || !state) return intent;

    const { intentName, parameters } = intent;
    const transactionalIntents = ['add_to_cart', 'product_compare', 'update_cart_quantity'];

    // Only reconcile for transactional intents where specific products are required
    if (!transactionalIntents.includes(intentName)) {
        return intent;
    }

    const lastSearch = state.product_context?.last_search;
    if (!lastSearch || !lastSearch.results || lastSearch.results.length === 0) {
        return intent;
    }

    // Identify if the user is referring to a category found in the search
    const categoryId = parameters.category;
    if (!categoryId) return intent;

    // RULE: If we have a category, but no specific product IDs (or only generic ones)
    const hasProducts = (parameters.products && parameters.products.length > 0) || parameters.product_id;

    // Check if the current products are actually generic word matches or category labels
    const isGeneric = (p) => ['something', 'product', 'item', 'stuff', 'one', 'items'].includes(p?.toString().toLowerCase());

    // Also treat category-label products as generic (e.g. products: ["iphones"] when category is iphones)
    const isCategoryLabel = (p) => {
        if (!storeContext.CATEGORIES) return false;
        const pLower = p?.toString().toLowerCase();
        return Object.values(storeContext.CATEGORIES).some(c =>
            c.label?.toLowerCase() === pLower ||
            c.slug?.toLowerCase() === pLower ||
            c.label?.toLowerCase().replace(/s$/, '') === pLower.replace(/s$/, '')
        );
    };

    const hasGenericProducts = parameters.products?.every(p => isGeneric(p) || isCategoryLabel(p)) || isGeneric(parameters.product_id);

    if (!hasProducts || hasGenericProducts) {
        // Find products in the last search that match this category
        // We match against category ID or label
        const matchedProducts = lastSearch.results.filter(p => {
            const pCat = p.category_id || p.category || (p.metadata && p.metadata.category_id);
            return pCat === categoryId;
        });

        if (matchedProducts.length > 0) {
            const productIds = matchedProducts.map(p => p.id || p.product_id || p.handle).filter(Boolean);

            logDebug('PIPELINE:CONTEXT_RECONCILER_MATCH', {
                _desc: 'Context reconciliation — map category to products from last_search',
                _example: '"buy it" + category from context → product_ids from last search',
                intent: intentName,
                category: categoryId,
                mappedProducts: productIds,
                reason: 'Resolved category label to last search results'
            });

            // Update parameters
            const updatedParams = { ...parameters };
            if (intentName === 'add_to_cart' || intentName === 'update_cart_quantity') {
                updatedParams.product_id = productIds[0];
                updatedParams.products = productIds;
            } else if (intentName === 'product_compare') {
                updatedParams.products = productIds;
            }

            return {
                ...intent,
                parameters: updatedParams,
                reconciledFromContext: true
            };
        }
    }

    return intent;
}

module.exports = { reconcile };
