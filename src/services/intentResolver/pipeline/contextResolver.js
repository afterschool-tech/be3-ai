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
    if (refKeys.length === 0) return { resolvedText: text, resolutions: [] };

    // Build a single-pass regex to avoid re-resolving already replaced text
    const patterns = refKeys.map(k => `\\b${escapeRegex(k.replace(/_/g, ' '))}\\b`).join('|');
    const regex = new RegExp(patterns, 'gi');

    resolvedText = text.replace(regex, (matched) => {
        const phrase = matched.toLowerCase();
        const refKey = phrase.replace(/ /g, '_');

        // Exact match check (or underscore version)
        const productId = referenceMap[refKey] || referenceMap[phrase];
        if (!productId) return matched;

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
            resolutions.push({
                original: matched,
                resolved: productName,
                productId: productId,
                source: 'reference_map'
            });
            return productName;
        }
        return matched;
    });

    return { resolvedText, resolutions };
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = { resolveReferences, resolveIdToName };
