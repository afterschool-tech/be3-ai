/**
 * Pipeline Stage 2: Context Resolver
 * Resolves pronouns, ordinals, brand references, and price references
 * using the state manager's reference_map and ordinal_list.
 * 
 * Imports: NONE from config (reads from state object)
 * Inline data: NONE
 */

/**
 * Ambiguous reference words that can be relative pronouns or temporal/discourse markers.
 * Only resolve these when context strongly suggests a product reference.
 */
const AMBIGUOUS_REFERENCE_WORDS = new Set([
    'it', 'this', 'that', 'then', 'the_one', 'the ones', 'ones',
    'them', 'those', 'these'  // can be relative/demonstrative or temporal marker
]);

/**
 * Check if an ambiguous reference should NOT be resolved (relative pronoun or temporal marker).
 * Returns true if we should SKIP resolution.
 */
function shouldSkipAmbiguousReference(text, matchIndex, matchedWord) {
    const lower = matchedWord.toLowerCase().trim();
    const withUnderscores = lower.replace(/\s+/g, '_');
    if (!AMBIGUOUS_REFERENCE_WORDS.has(lower) && !AMBIGUOUS_REFERENCE_WORDS.has(withUnderscores)) {
        return false; // Not ambiguous, allow resolution
    }

    const before = text.substring(0, matchIndex).trim();

    // Relative pronoun: "laptop that can", "phone that runs" — before ends with noun, matched word is the pronoun
    const relativePronounPattern = /\b(laptop|phone|one|thing|product|item|watch|speaker|console|computer|model|option|variant|version|brand|type)\s*$/i;
    if (relativePronounPattern.test(before)) {
        console.log(`[ContextResolver] ⏭️ Skipping "${matchedWord}" (relative pronoun) | before: "${before.slice(-50)}"`);
        return true;
    }

    // Temporal/discourse: "after that", "then that" — before ends with temporal word, matched word is the marker
    const temporalPattern = /\b(after|then|before|when|once|until|during|since|following)\s*$/i;
    if (temporalPattern.test(before)) {
        console.log(`[ContextResolver] ⏭️ Skipping "${matchedWord}" (temporal/discourse marker) | before: "${before.slice(-50)}"`);
        return true;
    }

    return false;
}

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
        console.log(`[ContextResolver] resolveReferences: no state or reference_map, passing through`);
        return { resolvedText: text, resolutions: [] };
    }

    const referenceMap = state.reference_map;
    const refKeys = Object.keys(referenceMap).sort((a, b) => b.length - a.length);
    console.log(`[ContextResolver] resolveReferences: input="${text.slice(0, 120)}${text.length > 120 ? '...' : ''}" | keys=[${refKeys.join(', ')}]`);
    const resolutions = [];
    let resolvedText = text;

    if (refKeys.length === 0) return { resolvedText: text, resolutions: [] };

    // Build a single-pass regex to avoid re-resolving already replaced text
    const patterns = refKeys.map(k => `\\b${escapeRegex(k.replace(/_/g, ' '))}\\b`).join('|');
    const regex = new RegExp(patterns, 'gi');

    resolvedText = text.replace(regex, (matched, offset, fullString) => {
        // Skip resolution when word is a relative pronoun or temporal/discourse marker
        if (shouldSkipAmbiguousReference(fullString, offset, matched)) return matched;

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
            console.log(`[ContextResolver] ✅ Resolved "${matched}" → "${productName}" (${productId})`);
            resolutions.push({
                original: matched,
                resolved: productName,
                productId: productId,
                source: 'reference_map'
            });
            return productName;
        }
        console.log(`[ContextResolver] ⚠️ Matched "${matched}" in reference_map → ${productId} but no product name in search results`);
        return matched;
    });

    if (resolutions.length > 0) {
        console.log(`[ContextResolver] resolveReferences: done | resolutions=${resolutions.length} | output="${resolvedText.slice(0, 120)}${resolvedText.length > 120 ? '...' : ''}"`);
    }
    return { resolvedText, resolutions };
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = { resolveReferences, resolveIdToName, shouldSkipAmbiguousReference };
