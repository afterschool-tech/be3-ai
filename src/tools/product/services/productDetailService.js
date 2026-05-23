const stateManager = require('../../../state/stateManager');
const { callBackendAPI } = require('../../../utils/apiClient');

/**
 * Enriches a single product with attributes. If attributes are missing,
 * falls back to checking the session state or executing a backend search.
 */
async function enrichProductAttributes(leanProduct, rawProduct, context, resolvedId) {
    if (!leanProduct) return;

    // 1. Try from state snapshot first
    try {
        const hasAttrs = !!(leanProduct?.metadata?.attributes && typeof leanProduct.metadata.attributes === 'object' && !Array.isArray(leanProduct.metadata.attributes) && Object.keys(leanProduct.metadata.attributes).length > 0);
        if (!hasAttrs && context?.sessionId) {
            const state = await stateManager.getState(context.sessionId);
            const last = state?.product_context?.last_search?.results;
            if (Array.isArray(last)) {
                const rawHandle = rawProduct?.metadata?.handle ? String(rawProduct.metadata.handle).trim() : null;
                const snap = last.find(p => {
                    if (!p) return false;
                    if (p.id && String(p.id) === String(resolvedId)) return true;
                    const h = p.handle || p.metadata?.handle;
                    if (h && String(h) === String(resolvedId)) return true;
                    if (rawHandle && h && String(h) === rawHandle) return true;
                    return false;
                });
                const snapAttrs = snap?.metadata?.attributes;
                if (snapAttrs && typeof snapAttrs === 'object' && !Array.isArray(snapAttrs) && Object.keys(snapAttrs).length > 0) {
                    if (!leanProduct.metadata) leanProduct.metadata = {};
                    leanProduct.metadata.attributes = snapAttrs;
                }
            }
        }
    } catch (_) { }

    // 2. Last resort: query the backend search endpoint and lift attributes
    try {
        const hasAttrsNow = !!(leanProduct?.metadata?.attributes && typeof leanProduct.metadata.attributes === 'object' && !Array.isArray(leanProduct.metadata.attributes) && Object.keys(leanProduct.metadata.attributes).length > 0);
        if (!hasAttrsNow) {
            const handle = rawProduct?.metadata?.handle ? String(rawProduct.metadata.handle).trim() : null;
            const nameQ = leanProduct?.name ? String(leanProduct.name).trim() : null;
            const q = handle || nameQ;
            if (q) {
                const searchParams = new URLSearchParams({
                    q: q,
                    per_page: '5'
                });
                const sr = await callBackendAPI(`/search/products?${searchParams.toString()}`);
                const candidates = sr?.data?.products || sr?.data?.results || [];
                if (Array.isArray(candidates) && candidates.length > 0) {
                    const match = candidates.find(p => {
                        if (!p) return false;
                        if (p.id && String(p.id) === String(resolvedId)) return true;
                        const h = p.handle || p.metadata?.handle;
                        if (h && (String(h) === String(resolvedId) || (handle && String(h) === handle))) return true;
                        return false;
                    }) || candidates[0];
                    const attrs = match?.metadata?.attributes;
                    if (attrs && typeof attrs === 'object' && !Array.isArray(attrs) && Object.keys(attrs).length > 0) {
                        if (!leanProduct.metadata) leanProduct.metadata = {};
                        leanProduct.metadata.attributes = attrs;
                    }
                }
            }
        }
    } catch (_) { }

    // Convenience alias: allow tools/prompting layers to read product.attributes directly.
    if (!leanProduct.attributes && leanProduct?.metadata?.attributes) {
        leanProduct.attributes = leanProduct.metadata.attributes;
    }
}

/**
 * Loads a map of fallback attributes by product ID from the user's last search context.
 * Useful when comparing multiple products.
 */
async function loadFallbackAttributesLookup(context) {
    let lastSearchAttributesById = {};
    try {
        if (context?.sessionId) {
            const state = await stateManager.getState(context.sessionId);
            const last = state?.product_context?.last_search?.results;
            if (Array.isArray(last)) {
                for (const p of last) {
                    if (!p) continue;
                    const attrs = p?.metadata?.attributes;
                    if (attrs && typeof attrs === 'object' && !Array.isArray(attrs)) {
                        if (p.id) lastSearchAttributesById[String(p.id)] = attrs;
                        const h = p.handle || p.metadata?.handle;
                        if (h) lastSearchAttributesById[String(h)] = attrs;
                    }
                }
            }

            // Also consult search_context.product_attributes_map (explicitly built before stripping)
            const sc = state?.search_context;
            const map = sc?.product_attributes_map;
            if (map && typeof map === 'object' && !Array.isArray(map)) {
                for (const [k, v] of Object.entries(map)) {
                    if (!k) continue;
                    if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
                    if (Object.keys(v).length === 0) continue;
                    lastSearchAttributesById[String(k)] = v;
                }
            }
        }
    } catch (_) { }
    return lastSearchAttributesById;
}

/**
 * Expands a product's attributes using the store context definitions.
 */
function expandAttributesForComparison(product, lastSearchAttributesById, context) {
    let raw = (product?.attributes && typeof product.attributes === 'object')
        ? product.attributes
        : (product?.metadata?.attributes && typeof product.metadata.attributes === 'object')
            ? product.metadata.attributes
            : {};

    // If getDetails payload doesn't include attributes, fall back to last search snapshot.
    if (raw && typeof raw === 'object' && !Array.isArray(raw) && Object.keys(raw).length === 0) {
        const fallback =
            (product?.id && lastSearchAttributesById[String(product.id)])
            || (product?.metadata?.handle && lastSearchAttributesById[String(product.metadata.handle)])
            || null;
        if (fallback && typeof fallback === 'object' && !Array.isArray(fallback)) {
            raw = fallback;
        }
    }

    const expanded = {};
    const attrDefs = context?.ATTRIBUTES || {};

    // Map known attribute codes (and keys) to stable keys for the LLM to compare.
    for (const [attrKey, def] of Object.entries(attrDefs)) {
        const code = def?.code;
        const v = (code && raw[code] !== undefined) ? raw[code] : raw[attrKey];
        if (v === undefined || v === null || v === '') continue;

        // Prefer canonical key names (attrKey) but also provide label alias if it differs.
        expanded[attrKey] = v;
        if (def?.label && def.label !== attrKey && expanded[def.label] === undefined) {
            expanded[def.label] = v;
        }
    }

    // Pass through any remaining raw attributes (codes or unknown keys) without exploding size.
    for (const [k, v] of Object.entries(raw || {})) {
        if (expanded[k] !== undefined) continue;
        if (v === undefined || v === null || v === '') continue;
        expanded[k] = v;
    }

    return { raw_attributes: raw, expanded_attributes: expanded };
}

module.exports = {
    enrichProductAttributes,
    loadFallbackAttributesLookup,
    expandAttributesForComparison
};
