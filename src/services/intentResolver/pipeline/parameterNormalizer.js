/**
 * Pipeline Stage 6.5: Parameter Normalizer
 * Resolves category/product name clashes by cross-referencing with store context.
 */

const { normalizeCategory } = require('../../../utils/normalization');

/**
 * Normalizes parameters for a list of resolved intents.
 * If a 'product_name' or item in 'products' matches a category, shift it to 'category'.
 * 
 * @param {Array} resolvedIntents - Array of { intentName, score, parameters, extractedParams }
 * @param {Object} storeContext - Store context for normalization
 * @returns {Array} - The modified intents
 */
function normalizeParameters(resolvedIntents, storeContext) {
    const categoriesContext = storeContext?.CATEGORIES;

    return resolvedIntents.map(intent => {
        const params = intent.parameters;

        // Only relevant for product-based intents
        if (!params.product_name && (!params.products || params.products.length === 0)) {
            return intent;
        }

        // 1. Check product_name (string)
        if (params.product_name) {
            // Use exactMatchOnly=true to avoid over-aggressive matching (e.g. "cheap iphones" shouldn't match "iphones" category)
            const resolvedCatId = normalizeCategory(params.product_name, categoriesContext, true);
            if (resolvedCatId) {
                console.log(`[Normalizer] Exact clash detected: "${params.product_name}" is a category. Shifting.`);
                params.category = resolvedCatId;
                params.product_name = null;
                // Update query if it was also there
                if (params.query === params.product_name) params.query = null;
                if (intent.extractedParams) intent.extractedParams.product_name = null;
            } else if (params.category && categoriesContext) {
                // REDUNDANCY CHECK: If category is already in the product name, it might be redundant
                // e.g. product_name: "iphone 13", category: "phones"
                const cat = Object.values(categoriesContext).find(c => c.id === params.category || c.slug === params.category);
                if (cat) {
                    const catLabel = cat.label.toLowerCase();
                    const prodLower = params.product_name.toLowerCase();
                    // If product name is "iphone 13" and category is "phones", "iphone" contains most of the semantic intent
                    // We only drop it if the product name is "substantial" (more than just the category name)
                    if (prodLower.includes(catLabel.replace(/s$/, '')) && prodLower.length > catLabel.length) {
                        console.log(`[Normalizer] Redundant category detected ("${cat.label}" in "${params.product_name}"). Dropping category filter.`);
                        params.category = null;
                        if (intent.extractedParams) intent.extractedParams.category = null;
                    }
                }
            }
        }

        // 2. Check products (list)
        if (params.products && Array.isArray(params.products)) {
            const newProducts = [];
            for (const p of params.products) {
                // Use exactMatchOnly=true
                const resolvedCatId = normalizeCategory(p, categoriesContext, true);
                if (resolvedCatId) {
                    console.log(`[Normalizer] Exact clash detected: list item "${p}" is a category. Shifting.`);
                    params.category = resolvedCatId;
                    // Note: We don't add it to newProducts, effectively removing it from the search list
                } else {
                    newProducts.push(p);
                }
            }
            params.products = newProducts;
            if (intent.extractedParams) intent.extractedParams.products = newProducts;
        }

        return intent;
    });
}

module.exports = { normalizeParameters };
