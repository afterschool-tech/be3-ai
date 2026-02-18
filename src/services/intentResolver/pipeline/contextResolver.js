/**
 * Pipeline Stage 2: Context Resolver
 * Resolves pronouns, ordinals, brand references, and price references
 * using the state manager's reference_map and ordinal_list.
 * 
 * Imports: NONE from config (reads from state object)
 * Inline data: NONE
 */

/**
 * Resolve product ID to product name using search results from state.
 */
function resolveIdToName(productId, state) {
    const results = state?.product_context?.last_search?.results || [];
    for (const product of results) {
        if (product.id === productId || product.handle === productId) {
            return product.name || product.title || null;
        }
    }
    return null;
}

/**
 * Resolve references in text using state data.
 * Scans for known reference patterns, replaces with product names.
 * Returns { resolvedText, resolutions[] }.
 */
function resolveReferences(text, state) {
    if (!state || !state.reference_map) {
        return { resolvedText: text, resolutions: [] };
    }

    const referenceMap = state.reference_map;
    const resolutions = [];
    let resolvedText = text;

    // Build sorted reference keys: longest first for greedy matching
    const refKeys = Object.keys(referenceMap).sort((a, b) => b.length - a.length);

    for (const refKey of refKeys) {
        // Convert underscore key back to natural phrase for matching
        const phrase = refKey.replace(/_/g, ' ');
        const regex = new RegExp(`\\b${escapeRegex(phrase)}\\b`, 'gi');

        if (regex.test(resolvedText)) {
            const productId = referenceMap[refKey];

            // Handle comma-separated IDs (plurals like "all of them")
            let productName;
            if (typeof productId === 'string' && productId.includes(',')) {
                const ids = productId.split(',');
                const names = ids.map(id => resolveIdToName(id.trim(), state)).filter(Boolean);
                productName = names.length > 0 ? names.join(' and ') : null;
            } else {
                productName = resolveIdToName(productId, state);
            }

            if (productName) {
                resolvedText = resolvedText.replace(regex, productName);
                resolutions.push({
                    original: phrase,
                    resolved: productName,
                    productId: productId,
                    source: 'reference_map'
                });
            }
        }
    }

    return { resolvedText, resolutions };
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = { resolveReferences, resolveIdToName };
