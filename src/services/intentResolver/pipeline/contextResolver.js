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
 
const {
    MODEL_QUALIFIER_WORDS
} = require('../config/contextResolverGuards');

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
 * Skip resolving generic brand tokens when they appear to be part of a new
 * model/product mention (e.g. "iPhone 17", "Samsung S24 Ultra").
 *
 * This prevents collisions where reference_map contains generic keys like "iphone"
 * that would otherwise be replaced inside new product mentions.
 */
function buildBrandTokenSet(storeContext) {
    const brands = new Set();

    const predefined = storeContext?.ATTRIBUTES?.brand?.predefined_values;
    if (Array.isArray(predefined)) {
        for (const b of predefined) {
            const v = (b?.value ?? '').toString().toLowerCase().trim();
            const l = (b?.label ?? '').toString().toLowerCase().trim();
            if (v) brands.add(v);
            if (l) brands.add(l);
        }
    }

    // Fallback tokens: brand-like words that may exist in product names / reference_map
    // but are not strictly "brands" in the storeContext attribute (e.g., iphone, macbook).
    const fallback = ['iphone', 'macbook'];
    fallback.forEach(x => brands.add(x));

    return brands;
}

function shouldSkipBrandCollision(text, matchIndex, matchedWord, storeContext) {
    const lower = matchedWord.toLowerCase().trim();

    const brandTokens = buildBrandTokenSet(storeContext);
    if (!brandTokens.has(lower)) return false;

    const after = text.substring(matchIndex + matchedWord.length);

    // If a model qualifier follows (numbers, sku-ish chunks, or common variant words),
    // treat it as a new product mention and do NOT resolve the brand token.
    const qualifierWords = MODEL_QUALIFIER_WORDS ? Array.from(MODEL_QUALIFIER_WORDS) : [];
    const qualifierWordsPattern = qualifierWords.length > 0 ? `(?:${qualifierWords.map(escapeRegex).join('|')})` : '(?!)';
    const modelQualifierPattern = new RegExp(`^\\s*(?:[0-9]+|[a-z]{1,3}[0-9]{1,4}|${qualifierWordsPattern})\\b`, 'i');

    if (modelQualifierPattern.test(after)) {
        console.log(`[ContextResolver] ⏭️ Skipping "${matchedWord}" (brand collision; model qualifier after) | after="${after.slice(0, 24)}"`);
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
function resolveReferences(text, state, storeContext) {
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

        // Skip brand-token collisions like "iPhone 17" where "iphone" would otherwise
        // be resolved to a previous product name from reference_map.
        if (shouldSkipBrandCollision(fullString, offset, matched, storeContext)) return matched;

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

module.exports = { resolveReferences, resolveIdToName, shouldSkipAmbiguousReference, shouldSkipBrandCollision };
