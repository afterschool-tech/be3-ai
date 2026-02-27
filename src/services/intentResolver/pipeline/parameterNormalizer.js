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
    const attributesContext = storeContext?.ATTRIBUTES;

    return resolvedIntents.map(intent => {
        const params = intent.parameters;

        // Compare intents should not treat clause words (e.g. brand tokens inside resolved product names)
        // as semantic search refinements. This prevents side effects like setting brand=infinix when the
        // user simply asked to compare products that include an Infinix item.
        const isCompareIntent = intent?.intentName === 'product_compare';

        // ── 1. Clause to Attribute Mapping ──
        // Handle both array format [{ clauseId, word }] and string format "clause_id"
        if (params.clause_words && !isCompareIntent) {
            if (!params.attributes) params.attributes = {};
            
            let clausesToProcess = [];
            if (Array.isArray(params.clause_words)) {
                clausesToProcess = params.clause_words;
            } else if (typeof params.clause_words === 'string') {
                // String format: "color_for_ladies" -> need to extract actual word
                // Try to extract word from product_name or products (e.g., "white" from "white ones")
                const clause = CLAUSES[params.clause_words];
                let extractedWord = params.clause_words; // fallback to clause ID
                
                if (clause && clause.matches && Array.isArray(clause.matches)) {
                    // Check if any clause match word appears in product_name or products
                    const searchText = [
                        params.product_name,
                        ...(Array.isArray(params.products) ? params.products : [params.products].filter(Boolean))
                    ].join(' ').toLowerCase();
                    
                    for (const match of clause.matches) {
                        if (searchText.includes(match.toLowerCase())) {
                            extractedWord = match;
                            break;
                        }
                    }
                }
                
                clausesToProcess = [{ clauseId: params.clause_words, word: extractedWord }];
            } else if (typeof params.clause_words === 'object' && params.clause_words !== null) {
                // Object format: convert to array
                clausesToProcess = Object.entries(params.clause_words).map(([k, v]) => ({
                    clauseId: k,
                    word: typeof v === 'string' ? v : k
                }));
            }

            clausesToProcess.forEach(c => {
                const clauseId = typeof c === 'object' ? (c.clauseId || c.id || String(c)) : String(c);
                const clauseWord = typeof c === 'object' ? (c.word || clauseId) : clauseId;
                const clause = CLAUSES[clauseId];
                
                if (clause && clause.attribute) {
                    let mapped = false;

                    // Prefer backend clause-filter encoding when we have ATTRIBUTES metadata.
                    // Example: price_tier affordable -> attribute.p:p=budget,midrange
                    try {
                        const attrKey = clause.attribute;
                        const attrMeta = attributesContext ? attributesContext[attrKey] : null;
                        const attrCode = attrMeta?.code;

                        const clauseLabelLower = String(clause.label || clauseId).toLowerCase().trim();
                        const attrClauseDefs = Array.isArray(attrMeta?.clauses) ? attrMeta.clauses : [];
                        const matchingAttrClause = attrClauseDefs.find(def =>
                            String(def?.label || '').toLowerCase().trim() === clauseLabelLower
                        );

                        if (attrCode && matchingAttrClause && matchingAttrClause.name) {
                            const matches = Array.isArray(matchingAttrClause.matches) ? matchingAttrClause.matches : [];
                            const csv = matches.map(x => String(x).trim()).filter(Boolean).join(',');
                            const compositeKey = `${attrCode}:${matchingAttrClause.name}`;

                            if (csv) {
                                params.attributes[compositeKey] = csv;
                                mapped = true;
                            }
                        }
                    } catch (_) {}

                    // Fallback: map to attribute raw key, but canonicalize against predefined values when possible.
                    if (!mapped) {
                        let finalValue = clauseWord;
                        try {
                            const attrMeta = attributesContext ? attributesContext[clause.attribute] : null;
                            const predefined = Array.isArray(attrMeta?.predefined_values) ? attrMeta.predefined_values : [];
                            const supportedValues = predefined
                                .map(v => (v && v.value !== undefined && v.value !== null) ? String(v.value).toLowerCase().trim() : null)
                                .filter(Boolean);

                            const clauseWordLower = String(clauseWord).toLowerCase().trim();
                            if (!supportedValues.includes(clauseWordLower)) {
                                const clauseMatches = Array.isArray(clause.matches) ? clause.matches : [];
                                const canonical = clauseMatches
                                    .map(m => String(m).toLowerCase().trim())
                                    .find(m => supportedValues.includes(m));
                                if (canonical) finalValue = canonical;
                            }
                        } catch (_) {}

                        params.attributes[clause.attribute] = finalValue;
                    }
                    console.log(`[ParameterNormalizer] 🔄 Mapped clause to attribute:`, {
                        clauseId: clauseId,
                        clauseWord: clauseWord,
                        attribute: clause.attribute,
                        attributeValue: params.attributes,
                        resulting_attributes: params.attributes
                    });
                } else {
                    console.log(`[ParameterNormalizer] ⚠️ Clause not mapped (no attribute):`, {
                        clauseId: clauseId,
                        clauseWord: clauseWord,
                        clauseFound: !!clause,
                        clauseHasAttribute: clause ? !!clause.attribute : false
                    });
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
            const resolvedCatId = normalizeCategory(params.product_name, categoriesContext, true, { debug: true, topK: 5 });
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
                const resolvedCatId = normalizeCategory(p, categoriesContext, true, { debug: true, topK: 5 });
                if (resolvedCatId) {
                    params.category = resolvedCatId;
                } else {
                    newProducts.push(p);
                }
            }
            params.products = newProducts;
        }

        // Preserve _ported_from flag through normalization
        // (intent object is mutated, so _ported_from should already be preserved, but be explicit)
        return intent;
    });
}

module.exports = { normalizeParameters };
