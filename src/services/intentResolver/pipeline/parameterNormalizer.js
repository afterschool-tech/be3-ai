/**
 * Pipeline Stage 6.5: Parameter Normalizer
 * Resolves category/product name clashes by cross-referencing with store context.
 * Maps 'clause_words' to 'attributes' for semantic filtering.
 * Verifies and normalizes vendors against official store tenants.
 */

const { normalizeCategory } = require('../../../utils/normalization');
const { CLAUSES } = require('../../../context/clauses');

/**
 * Normalizes parameters for a list of resolved intents.
 * 
 * @param {Array} resolvedIntents - Array of { intentName, score, parameters, extractedParams }
 * @param {Object} storeContext - Store context for normalization
 * @returns {Array} - The modified intents
 */
function normalizeParameters(resolvedIntents, storeContext) {
    const categoriesContext = storeContext?.CATEGORIES;
    const vendorsContext = storeContext?.VENDORS;

    return resolvedIntents.map(intent => {
        const params = intent.parameters;

        // ── 1. Clause to Attribute Mapping ──
        if (params.clause_words && Array.isArray(params.clause_words)) {
            if (!params.attributes) params.attributes = {};

            params.clause_words.forEach(c => {
                const clause = CLAUSES[c.clauseId];
                if (clause && clause.attribute) {
                    params.attributes[clause.attribute] = c.word;
                }
            });
        }

        // ── 2. Vendor Normalization ──
        // Only allow official store tenants in the 'vendor' slot
        if (params.vendor && vendorsContext) {
            const vLower = params.vendor.toLowerCase();
            const officialVendor = Object.values(vendorsContext).find(v =>
                v.business_name.toLowerCase() === vLower ||
                v.tag.toLowerCase() === vLower ||
                v.id.toLowerCase() === vLower
            );

            if (officialVendor) {
                params.vendor = officialVendor.id;
            } else {
                // Not an official vendor. 
                // If it looks like a brand name (already captured as an attribute), drop it from vendor.
                if (params.attributes && params.attributes.brand) {
                    params.vendor = null;
                } else {
                    // Possible unknown vendor - leave as is for tool to handle? 
                    // Or check if it's a known brand from clauses anyway.
                    const brandClause = Object.values(CLAUSES).find(c =>
                        c.attribute === 'brand' &&
                        (c.matches.includes(vLower) || c.label.toLowerCase().includes(vLower))
                    );
                    if (brandClause) {
                        if (!params.attributes) params.attributes = {};
                        params.attributes.brand = vLower;
                        params.vendor = null;
                    }
                }
            }
        }

        // Only relevant for product/category intents
        if (!params.product_name && (!params.products || params.products.length === 0)) {
            return intent;
        }

        // ── 3. Category Shifting (Exact Matches) ──
        if (params.product_name) {
            const resolvedCatId = normalizeCategory(params.product_name, categoriesContext, true);
            if (resolvedCatId) {
                params.category = resolvedCatId;
                params.product_name = null;
                if (params.query === params.product_name) params.query = null;
            } else if (params.category && categoriesContext) {
                const cat = Object.values(categoriesContext).find(c => c.id === params.category || c.slug === params.category);
                if (cat) {
                    const catLabel = cat.label.toLowerCase();
                    const prodLower = params.product_name.toLowerCase();
                    if (prodLower.includes(catLabel.replace(/s$/, '')) && prodLower.length > catLabel.length) {
                        params.category = null;
                    }
                }
            }
        }

        // ── 4. List Normalization ──
        if (params.products && Array.isArray(params.products)) {
            const newProducts = [];
            for (const p of params.products) {
                const resolvedCatId = normalizeCategory(p, categoriesContext, true);
                if (resolvedCatId) {
                    params.category = resolvedCatId;
                } else {
                    newProducts.push(p);
                }
            }
            params.products = newProducts;
        }

        return intent;
    });
}

module.exports = { normalizeParameters };
