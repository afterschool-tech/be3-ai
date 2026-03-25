/**
 * Product Tools
 * Capabilities related to product search and details.
 */

const { CATEGORIES, VENDORS, ATTRIBUTES } = require('../context/storeContext');
const { normalizeCategory, normalizeVendor, isOrdinalOrReferencePhrase } = require('../utils/normalization');
const { resolveProduct } = require('../utils/productResolver');
const { performSemanticSearch } = require('../utils/searchUtility');
const { performVectorSearch, performSimilarSearch } = require('../utils/vectorSearchUtility');
const { callBackendAPI } = require('../utils/apiClient');
const stateManager = require('../state/stateManager');
const { processProductList } = require('../utils/productUtility');
const { 
    buildProductCards, 
    buildFacetRefinerButtons, 
    deriveClauseNameFromAttributes, 
    buildDefaultSeeMoreTitle, 
    pickVendorSeeMoreTitle 
} = require('../utils/storefrontWhatsAppUx');
const crypto = require('crypto');

function encodeBase64Url(str) {
    return Buffer.from(String(str || ''), 'utf8')
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
}

const productTools = {
    'product.search': {
        description: 'Advanced search for products. Supports keywords, category, price ranges, and dynamic attributes (e.g. brand, color).',
        params: {
            query: { type: 'string', description: 'Search keywords' },
            category: { type: 'string', description: 'Category name or slug' },
            price_min: { type: 'number', description: 'Minimum price' },
            price_max: { type: 'number', description: 'Maximum price' },
            limit: { type: 'number', description: 'Max results (default 5)' },
            page: { type: 'number', description: 'Pagination page (1-indexed, default 1)' },
            sort: { type: 'string', description: 'price_asc, price_desc, date_desc, relevance' },
            tag: { type: 'string', description: 'The exact vendor tag (e.g. "Taye\'s Home Decor"). Use this when searching for products from a specific vendor.' },
            attributes: { type: 'object', description: 'Dynamic filters like { b: "Apple", color: "Red" } using attribute codes' },
            search_mode: { type: 'string', description: 'The search mode to use. Set to "VECTOR" for pure semantic search.' },
            similar_to: { type: 'string', description: 'The Product ID or Handle to find products similar to.' },
            clause_words: { type: 'list', description: 'Internal: detected semantic clauses for labeling' }
        },
        handler: async (params, context) => {
            const { query, category, price_min, price_max, limit = 5, page = 1, sort = 'relevance', tag, attributes = {}, search_mode, similar_to, clause_words } = params;
            const safeAttributes = attributes || {};

            const snapshotId = crypto.randomBytes(4).toString('hex');
            try {
                if (context.sessionId) {
                    await stateManager.setSearchSnapshot(context.sessionId, snapshotId, { ...params, page });
                }
            } catch (_) { }

            let catId = normalizeCategory(category);
            const catKey = catId ? Object.keys(context.CATEGORIES || {}).find(k => context.CATEGORIES[k].id === catId) : null;
            const cat = catKey ? context.CATEGORIES[catKey] : null;

            // --- STAGE 0: Context-First Check ---
            if (cat && cat.total_count === 0) {
                return {
                    products: [],
                    total: 0,
                    facets: {},
                    message: `We currently don't have any products in the **${cat.label}** section.`
                };
            }

            // --- STAGE 0.2: Pure Vector / Similarity Mode ---
            if (search_mode === 'VECTOR' || similar_to) {
                const { logDebug } = require('../utils/debugLogger');
                let vectorResult = null;
                let resolvedSimilarityId = null; // hoisted so annotation block can access it
                const extraParams = { price_min, price_max, tag, attributes: safeAttributes };

                if (similar_to) {
                    logDebug('TOOL:SIMILAR_SEARCH_MODE [product.search]', { similar_to, limit, hasFilters: true });
                    
                    // NEW: Optimization — if similar_to is already a UUID (e.g. from an engineered token), use it directly.
                    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(similar_to);
                    resolvedSimilarityId = isUuid ? similar_to : await resolveProduct(similar_to, context, { category: catId });
                    
                    if (!resolvedSimilarityId) {
                        logDebug('TOOL:SIMILAR_SEARCH_FAILED [product.search]', { similar_to, reason: 'unresolved' });
                    } else {
                        vectorResult = await performSimilarSearch(resolvedSimilarityId, limit, extraParams);
                        
                        // Fallback to unfiltered similarity if filtered returns nothing
                        if (!vectorResult || vectorResult.products.length === 0) {
                            logDebug('TOOL:SIMILAR_FALLBACK_UNFILTERED [product.search]', { similar_to: resolvedSimilarityId });
                            vectorResult = await performSimilarSearch(resolvedSimilarityId, limit);
                        }
                    }
                } else if (query) {
                    logDebug('TOOL:VECTOR_SEARCH_MODE [product.search]', { query, limit, hasFilters: true });
                    vectorResult = await performVectorSearch(query, limit, catId, extraParams);

                    // Fallback to unfiltered vector if filtered returns nothing
                    if (!vectorResult || vectorResult.products.length === 0) {
                        logDebug('TOOL:VECTOR_FALLBACK_UNFILTERED [product.search]', { query });
                        vectorResult = await performVectorSearch(query, limit, catId);
                    }
                }

                if (vectorResult && vectorResult.products && vectorResult.products.length > 0) {
                    const finalResult = await handleSearchResults(vectorResult, params, context, snapshotId, cat, catId);

                    // SIMILARITY CONTEXT: Annotate the result so the personality layer knows
                    // these are "similar to X" results, not general search results.
                    // The LLM uses this to say "here are products similar to Iphone 12 Pro" 
                    // instead of acting confused or dismissive.
                    if (similar_to) {
                        finalResult.mode = 'similar';
                        finalResult.similar_to = resolvedSimilarityId;
                        // Derive a human-readable reference name:
                        // If similar_to was a product name (not UUID), use it directly.
                        // Otherwise, try to find the name from the resolved UUID in the reference map or state.
                        const isInputUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(similar_to);
                        if (!isInputUuid) {
                            finalResult.similar_to_name = similar_to; // it was a name already
                        } else {
                            // Try to resolve from state context
                            try {
                                const state = await stateManager.getState(context.sessionId);
                                const lastResults = state?.product_context?.last_search?.results;
                                const refMap = state?.reference_map || {};
                                let resolvedName = null;
                                if (Array.isArray(lastResults)) {
                                    const found = lastResults.find(p => p.id === similar_to || p.handle === similar_to);
                                    if (found) resolvedName = found.name || found.title;
                                }
                                if (!resolvedName) {
                                    // Check reference_map in reverse
                                    for (const [alias, id] of Object.entries(refMap)) {
                                        if (id === similar_to) { resolvedName = alias; break; }
                                    }
                                }
                                if (resolvedName) finalResult.similar_to_name = resolvedName;
                            } catch (_) {}
                        }
                    }

                    return finalResult;
                }
            }

            // --- STAGE 1: Unified Precision Search ---
            const searchParams = new URLSearchParams({
                type: 'product',
                per_page: limit,
                page: page,
                sort: sort
            });
            if (query) searchParams.append('q', query);
            if (price_min) searchParams.append('price_min', price_min);
            if (price_max) searchParams.append('price_max', price_max);
            if (tag) searchParams.append('tag', tag);
            if (catId) searchParams.append('category_id', cat?.slug || catId);

            Object.entries(safeAttributes).forEach(([key, val]) => {
                const finalVal = key === 'vendor' ? normalizeVendor(val) : val;
                searchParams.append(`attribute.${key}`, finalVal);
            });

            const result = await callBackendAPI(`/search?${searchParams.toString()}`);
            if (!result.success) return { error: "Failed to search products", details: result.error };

            const searchData = result.data || {};
            const products = searchData.results || searchData.products || [];
            const total = searchData.pagination?.total ?? searchData.total ?? 0;

            if (products.length > 0) {
                return await handleSearchResults({ products, total, facets: searchData.facets, pagination: searchData.pagination }, params, context, snapshotId, cat, catId);
            }

            // --- STAGE 2: Fallbacks ---
            const { logDebug } = require('../utils/debugLogger');

            // Fallback 1: Vector Search (Primary Fallback)
            if (query && !search_mode && !similar_to) {
                const extraParams = { price_min, price_max, tag, attributes: safeAttributes };
                // Try with filters first
                let vectorFallback = await performVectorSearch(query, limit, catId, extraParams);
                
                // If filtered fails, try unfiltered
                if (!vectorFallback || vectorFallback.products?.length === 0) {
                    vectorFallback = await performVectorSearch(query, limit, catId);
                }

                if (vectorFallback && vectorFallback.products?.length > 0) {
                    logDebug('TOOL:VECTOR_FALLBACK [product.search]', { _desc: 'Precision failed. Result found via Vector Search fallback.', query });
                    return await handleSearchResults(vectorFallback, params, context, snapshotId, cat, catId);
                }
            }

            // Fallback 2: Suggestion fallbacks (Relaxed searches)
            const buildRelaxedCall = async (opts) => {
                const { dropQuery, dropOtherFilters } = opts;
                const sParams = new URLSearchParams({ per_page: limit, page: page, sort: sort, type: 'product' });
                if (!dropQuery && query) sParams.append('q', query);
                if (!dropOtherFilters) {
                    if (price_min) sParams.append('price_min', price_min);
                    if (price_max) sParams.append('price_max', price_max);
                    if (tag) sParams.append('tag', tag);
                    Object.entries(safeAttributes).forEach(([k, v]) => sParams.append(`attribute.${k}`, k === 'vendor' ? normalizeVendor(v) : v));
                }
                if (catId) sParams.append('category_id', cat?.slug || catId);

                const res = await callBackendAPI(`/search?${sParams.toString()}`);
                if (!res.success) return null;
                const data = res.data || {};
                return {
                    products: data.results || data.products || [],
                    total: data.pagination?.total ?? data.total ?? 0,
                    facets: data.facets,
                    pagination: data.pagination
                };
            };

            // Attempt 1: Drop query, keep filters
            const attempt1 = await buildRelaxedCall({ dropQuery: true, dropOtherFilters: false });
            if (attempt1 && attempt1.products.length > 0) {
                const final = await handleSearchResults(attempt1, params, context, snapshotId, cat, catId, true);
                const seeMoreBtn = final.whatsapp?.buttons?.find(b => b.id.startsWith('__nav:more')) || { id: `__nav:more:${snapshotId}__`, title: 'See more' };
                return {
                    ...final,
                    products: [],
                    suggested_products: final.products.map(p => ({...p, suppress_images: true})),
                    suggested_total: final.total,
                    suggestion_message: "I couldn't find an exact match for your request. Here are some suggestions you might like instead.",
                    whatsapp_product_cards: undefined,
                    whatsapp: {
                        type: 'button',
                        buttons: [
                            { id: '__nav:results__', title: 'See product details' },
                            seeMoreBtn
                        ]
                    }
                };
            }

            // Attempt 2: Drop everything but category
            const attempt2 = await buildRelaxedCall({ dropQuery: true, dropOtherFilters: true });
            if (attempt2 && attempt2.products.length > 0) {
                const final = await handleSearchResults(attempt2, params, context, snapshotId, cat, catId, true);
                const seeMoreBtn = final.whatsapp?.buttons?.find(b => b.id.startsWith('__nav:more')) || { id: `__nav:more:${snapshotId}__`, title: 'See more' };
                return {
                    ...final,
                    products: [],
                    suggested_products: final.products.map(p => ({...p, suppress_images: true})),
                    suggested_total: final.total,
                    suggestion_message: "I couldn't find an exact match for your request. Here are some suggestions you might like instead.",
                    whatsapp_product_cards: undefined,
                    whatsapp: {
                        type: 'button',
                        buttons: [
                            { id: `__nav:cards:${snapshotId}__`, title: 'See product details' },
                            seeMoreBtn
                        ]
                    }
                };
            }

            return { products: [], total: 0, message: "I couldn't find any products matching your search." };
        }
    },

    'product.showCards': {
        description: 'Internal utility tool to render product cards from an active state snapshot',
        params: {
            snapshot_id: { type: 'string', description: 'The snapshot ID for the cached products' }
        },
        handler: async (params, context) => {
            const { snapshot_id } = params;
            
            let cachedProducts = [];
            try {
                // Try targeted snapshot first
                const snap = await stateManager.getSearchSnapshot(context.sessionId, snapshot_id);
                if (snap && Array.isArray(snap.results) && snap.results.length > 0) {
                    cachedProducts = snap.results;
                } else {
                    // Fallback to active state
                    const state = await stateManager.getState(context.sessionId);
                    const lastSearch = state?.product_context?.last_search?.results;
                    if (Array.isArray(lastSearch) && lastSearch.length > 0) {
                        cachedProducts = lastSearch;
                    }
                }
            } catch (e) {}

            if (cachedProducts.length === 0) {
                return { error: "Could not retrieve the product cards because the session context expired." };
            }

            const cardsPayload = buildProductCards(cachedProducts.filter(Boolean));
            
            return {
                directResponse: true,
                message: "Here are the details for the products:",
                whatsapp_product_cards: cardsPayload.cards.length > 0 ? { type: 'button', transaction: 'product_card', cards: cardsPayload.cards } : undefined
            };
        }
    },

    'product.getDetails': {
        description: 'Get full product details including images and specs using a product ID',
        params: {
            product_id: { type: 'string', description: 'The UUID of the product' }
        },
        handler: async (params, context) => {
            const { product_id, _suppress_ambient } = params;
            const resolvedId = await resolveProduct(product_id, context);

            if (!resolvedId) {
                return { 
                    message: `I couldn't find a product matching "${product_id}". Would you like me to search for it instead?`,
                    whatsapp: {
                        type: 'button',
                        buttons: [
                            { id: product_id, title: `Search for "${product_id.substring(0, 15)}..."` }
                        ]
                    }
                };
            }

            const result = await callBackendAPI(`/products/storefront/products/${resolvedId}`);

            if (!result.success || !result.data.product) {
                return { error: `I couldn't find the details for this product right now. Please try again or search for something else.` };
            }

            const rawProduct = result.data.product;
            const vendorTag =
                (Array.isArray(rawProduct.tags) ? rawProduct.tags[0] : null) ||
                (Array.isArray(rawProduct.metadata?.tags) ? rawProduct.metadata.tags[0] : null);
            const vendorKey = vendorTag ? encodeBase64Url(String(vendorTag)) : null;

            // --- DATA STRIPPING & IMAGE CACHING ---
            const { processProductData } = require('../utils/productUtility');
            const leanProduct = await processProductData(rawProduct);

            // Ensure attributes/specs are present.
            // Some backend payloads may omit metadata.attributes on the details endpoint,
            // but search snapshots in state usually contain them.
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

            // Last resort: if the details payload omits attributes AND we don't have a usable snapshot,
            // query the backend search endpoint and lift attributes from the search result.
            // This reduces microstate-route dependence on last_search context.
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

            if (context.sessionId && result.data.product && !_suppress_ambient) {
                await stateManager.setCurrentlyViewing(context.sessionId, resolvedId);
                
                // --- AMBIENT CONTEXT: Record active product topic ---
                await stateManager.setActiveTopic(context.sessionId, {
                    type: "single_product",
                    category_id: rawProduct.metadata?.category_ids?.[0] || null,
                    category_label: rawProduct.metadata?.category_names?.[0] || null,
                    vendor: rawProduct.metadata?.attributes?.vendor || vendorTag || null,
                    product_id: leanProduct.id || resolvedId,
                    product_name: leanProduct.name || rawProduct.name,
                    attributes: null
                });

                await stateManager.learnFromBehavior(context.sessionId, 'view_product', {
                    brand: result.data.product.metadata?.attributes?.v || 'Be3 Store'
                });
            }

            const buttons = [
                { id: `__cart:add:${resolvedId}__`, title: 'Add to cart' },
                { id: `__product:compare:${resolvedId}__`, title: 'Compare' },
                { id: `show similar to ${leanProduct.name || resolvedId}`, title: 'Show similar' }
            ];

            // Vendor rule: only show Vendor info when a tag exists; if no tag, product has no vendor.
            if (vendorKey) {
                buttons.push({ id: `__vendor:info:${vendorKey}__`, title: 'Vendor info' });
            }

            return {
                message: `Here’s more information about **${leanProduct.name || leanProduct.title || 'this product'}**.`,
                product: leanProduct,
                whatsapp: {
                    type: 'button',
                    buttons
                }
            };
        }
    },

    'product.compare': {
        description: 'Compare multiple products side-by-side',
        params: {
            product_ids: { type: 'array', description: 'List of product UUIDs to compare' },
            product_segments: { type: 'array', description: 'List of product segments with localized metadata' }
        },
        handler: async (params, context) => {
            const { product_segments = [] } = params;
            let { product_ids = [] } = params;
            if (typeof product_ids === 'string') product_ids = [product_ids];

            const products = [];

            if (product_segments.length >= 2) {
                // --- NEW SEGMENTED FLOW ---
                for (const seg of product_segments) {
                    const identifier = seg.query;
                    const constraints = {};
                    if (seg.category) constraints.category = seg.category;
                    if (seg.attributes?.brand) constraints.brand = seg.attributes.brand;

                    const resolvedId = seg._resolved_product_id || await resolveProduct(identifier, context, constraints);
                    if (resolvedId) {
                        const res = await productTools['product.getDetails'].handler({ product_id: resolvedId, _suppress_ambient: true }, context);
                        if (!res.error) products.push(res.product);
                    }
                }
            } else {
                // --- LEGACY FALLBACK FLOW ---
                if (product_ids.length < 2) return { error: "Please provide at least 2 products to compare." };
                for (const id of product_ids) {
                    const resolvedId = await resolveProduct(id, context);
                    if (resolvedId) {
                        const res = await productTools['product.getDetails'].handler({ product_id: resolvedId, _suppress_ambient: true }, context);
                        if (!res.error) products.push(res.product);
                    }
                }
            }

            if (products.length < 2) return { error: "Could not find enough products for comparison." };

            // Update reference_map / ordinal_list so follow-up commands (e.g. "add the samsung")
            // resolve against this comparison set without requiring a product.search in between.
            try {
                if (context?.sessionId) {
                    const scope = context && context.microstate_active ? 'microstate' : 'global';
                    await stateManager.updateReferenceMap(context.sessionId, products, { scope });
                    await stateManager.updateLastSearch(
                        context.sessionId,
                        `Comparison: ${products.map(p => p.name || p.title || p.id).filter(Boolean).join(' vs ')}`,
                        { product_ids },
                        products,
                        products.length
                    );
                    const firstId = products[0]?.id || products[0]?.handle || products[0]?.product_id;
                    if (firstId) await stateManager.setCurrentlyViewing(context.sessionId, firstId);
                    
                    // --- AMBIENT CONTEXT: Record comparison topic ---
                    await stateManager.setActiveTopic(context.sessionId, {
                        type: "comparison",
                        category_id: products[0]?.metadata?.category_ids?.[0] || null,
                        category_label: products[0]?.metadata?.category_names?.[0] || null,
                        vendor: null,
                        product_id: null,
                        product_name: null,
                        product_ids: products.map(p => p.id || p.handle).filter(Boolean),
                        attributes: null
                    });
                }
            } catch (_) { }

            // Fallback attribute source:
            // - product.search results stored in state often include metadata.attributes (codes like b/c/j/m/p)
            // - product.getDetails backend response may omit them depending on endpoint payload
            // We load last_search once and build a lookup by product id.
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
                    // so compare-button flows still get attributes even if last_search doesn't include the product.
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

            const expandAttributes = (product) => {
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
                // This preserves fields like "storage" or custom sizes even if storeContext is missing a definition.
                for (const [k, v] of Object.entries(raw || {})) {
                    if (expanded[k] !== undefined) continue;
                    if (v === undefined || v === null || v === '') continue;
                    expanded[k] = v;
                }

                return { raw_attributes: raw, expanded_attributes: expanded };
            };

            return {
                comparison: products.map(p => ({
                    id: p.id || null,
                    name: p.name || p.title || null,
                    title: p.title || p.name || null,
                    price: p.price ?? null,
                    vendor: p.vendor || p.metadata?.vendor || null,
                    whatsapp_link: p.whatsapp_link || p.metadata?.whatsapp_link || null,
                    checkout_url: p.checkout_url || p.metadata?.checkout_url || null,
                    ...expandAttributes(p),
                    description: p.description || null
                }))
            };
        }
    },

    'product.getAdvice': {
        description: 'Provide shopping advice, comparisons, or recommendations based on specific categories or needs.',
        params: {
            category: { type: 'string', description: 'Subject category' },
            need: { type: 'string', description: 'User need (e.g. "gaming", "budget")' }
        },
        handler: async (params, context) => {
            const { category, need } = params;
            const catId = normalizeCategory(category);
            const cat = catId ? context.CATEGORIES[Object.keys(context.CATEGORIES).find(k => context.CATEGORIES[k].id === catId)] : null;

            if (!cat) return {
                advice: "I couldn't find specific data for that category, but generally, when shopping for " + (category || "electronics") + ", you should look for reliable brands and check the warranty options.",
                suggested_action: "Would you like me to show you our top-level categories instead?"
            };

            const attributes = (cat.attributes || []).map(a => context.ATTRIBUTES[a]).filter(Boolean);
            const keyFeature = attributes.length > 0 ? attributes[0].label : "quality";

            return {
                category: cat.label,
                advice: `When looking for ${cat.label} ${need ? 'for ' + need : ''}, the most important factor is usually ${keyFeature}. We have ${cat.total_count} items in this section.`,
                suggested_filters: attributes.slice(0, 2).map(a => a.label),
                next_step: `I can search for ${need || ''} ${cat.label} for you.`
            };
        }
    },

    'product.findCheapest': {
        description: 'Find the lowest priced items in a category',
        params: {
            category: { type: 'string', description: 'Category name or slug' },
            limit: { type: 'number', description: 'Number of items (default 3)' }
        },
        handler: async (params, context) => {
            return await productTools['product.search'].handler({
                ...params,
                sort: 'price_asc'
            }, context);
        }
    },

    'product.checkAvailability': {
        description: 'Check if a product is in stock',
        params: {
            product_id: { type: 'string', description: 'Product ID or Name' }
        },
        handler: async (params, context) => {
            const resolvedId = await resolveProduct(params.product_id, context);
            const res = await productTools['product.getDetails'].handler({ product_id: resolvedId }, context);
            if (res.error) return res;

            const p = res.product;
            const stock = p.inventory_quantity ?? 0;
            const fakeStock = stock > 0 ? stock : 50;

            return {
                name: p.name,
                in_stock: true,
                quantity: fakeStock,
                status: 'Available'
            };
        }
    },

    'product.similarItems': {
        description: 'Find products similar to a target product',
        params: {
            product_id: { type: 'string', description: 'Product ID or Name' }
        },
        handler: async (params, context) => {
            const resolvedId = await resolveProduct(params.product_id, context);
            const res = await productTools['product.getDetails'].handler({ product_id: resolvedId }, context);
            if (res.error) return res;

            const product = res.product;
            const category_ids = product.metadata?.category_ids || [];
            if (category_ids.length === 0) return { error: "Could determine similarity context" };

            const search = await productTools['product.search'].handler({
                category: category_ids[0],
                limit: 5
            }, context);

            const similar = (search.products || []).filter(p => p.id !== resolvedId);

            return {
                original: product.name,
                similar_products: similar.slice(0, 3)
            };
        }
    },

    'product.getImage': {
        description: 'Retrieve images for products. Use this when the user specifically asks to see photos, pictures, or images.',
        params: {
            query: { type: 'string', description: 'Search keywords' },
            category: { type: 'string', description: 'Category name or slug' },
            price_min: { type: 'number', description: 'Minimum price' },
            price_max: { type: 'number', description: 'Maximum price' },
            limit: { type: 'number', description: 'Max results (default 5)' },
            sort: { type: 'string', description: 'price_asc, price_desc, date_desc, relevance' },
            tag: { type: 'string', description: 'The exact vendor tag (e.g. "Tayes Home Decor"). Use this when searching for products from a specific vendor.' },
            attributes: { type: 'object', description: 'Dynamic filters like { b: "Apple", color: "Red" } using attribute codes' },
            product_id: { type: 'string', description: 'Specific product ID if known' }
        },
        handler: async (params, context) => {
            const searchResult = await productTools['product.search'].handler({
                ...params,
                limit: params.limit || 5
            }, context);

            if (searchResult.error) return searchResult;

            const strippedProducts = (searchResult.products || []).map(p => ({
                id: p.id,
                name: p.name,
                price: p.price,
                content_type: 'product'
            }));

            if (strippedProducts.length === 0) {
                return { message: "I couldn't find any images matching that description." };
            }

            return {
                message: `Here are the images for "${params.query || 'your request'}":`,
                products: strippedProducts,
                instruction: "Display these images to the user. Do not generate detailed descriptions."
            };
        }
    },

    'product.facets': {
        description: 'Discover available options (facets) for product attributes like storage, brand, or color. Runs the same search as product.search but focuses on facet aggregation.',
        params: {
            facet_target: { type: 'string', description: 'The attribute to list (e.g., storage, brand, color)' },
            query: { type: 'string', description: 'Product name/query to scope the facet search' },
            category: { type: 'string', description: 'Category to scope the facet search (ID or slug)' },
            vendor: { type: 'string', description: 'Vendor to scope the facet search' },
            attributes: { type: 'object', description: 'Dynamic attribute filters (e.g., { "b:i": "infinix" })' },
            product_id: { type: 'string', description: 'Specific product ID to scope the facet search' },
            _resolved_product_id: { type: 'string', description: 'Internal resolved product ID' }
        },
        handler: async (params, context) => {
            const { facet_target, query, category, vendor, attributes = {}, product_id, _resolved_product_id } = params;
            const targetId = _resolved_product_id || product_id;

            // ── 1. Resolve facet_target (plural → canonical) ──
            let canonicalCode = facet_target ? facet_target.toLowerCase().trim() : null;
            if (canonicalCode && !ATTRIBUTES[canonicalCode]) {
                const singular = canonicalCode.replace(/s$/, '');
                if (ATTRIBUTES[singular]) {
                    canonicalCode = singular;
                } else {
                    for (const [code, attr] of Object.entries(ATTRIBUTES)) {
                        if (attr.label?.toLowerCase() === canonicalCode || attr.label?.toLowerCase() === singular) {
                            canonicalCode = code;
                            break;
                        }
                    }
                    if (!ATTRIBUTES[canonicalCode]) {
                        try {
                            const { resolveFacetAttribute } = require('../utils/semanticFacetResolver');
                            const resolved = resolveFacetAttribute(canonicalCode);
                            if (resolved) canonicalCode = resolved;
                        } catch (_) { }
                    }
                }
            }
            const attrDef = ATTRIBUTES[canonicalCode];
            const attrCode = attrDef ? attrDef.code : canonicalCode;
            const resolvedLabel = attrDef ? attrDef.label : (canonicalCode || 'attribute');

            // ── 1.2. Short-circuit: Check State Cache first (Bug 2 Fix) ──
            if (targetId && context?.sessionId) {
                try {
                    const state = await stateManager.getState(context.sessionId);
                    
                    // Strategy A: Check search_context.product_attributes_map (explicitly populated during search)
                    const sc = state?.search_context;
                    if (sc?.product_attributes_map && sc.product_attributes_map[targetId]) {
                        const pAttrs = sc.product_attributes_map[targetId];
                        const val = pAttrs[attrCode] || pAttrs[canonicalCode] || pAttrs[resolvedLabel.toLowerCase()];
                        if (val) {
                            const isVendor = attrCode === 'vendor' || canonicalCode === 'vendor' || resolvedLabel.toLowerCase() === 'vendor';
                            const btnId = isVendor ? `__vendor:products:${encodeBase64Url(val)}__` : '__nav:results__';
                            const btnTitle = isVendor ? `See ${val}'s products` : 'See products';

                            return {
                                message: `The **${resolvedLabel}** for this product is **${val}**.`,
                                facet_target: resolvedLabel,
                                options: [{ value: val, count: 1 }],
                                scope: 'product',
                                scope_label: targetId,
                                source: 'state_cache',
                                whatsapp: {
                                    type: 'button',
                                    buttons: [{ id: btnId, title: btnTitle }]
                                }
                            };
                        }
                    }

                    // Strategy B: Check last_search results
                    const lastResults = state?.product_context?.last_search?.results;
                    if (Array.isArray(lastResults)) {
                        const product = lastResults.find(p => (p.id === targetId || p.handle === targetId || p.product_id === targetId));
                        if (product) {
                            const pAttrs = product.attributes || product.metadata?.attributes || {};
                            const val = pAttrs[attrCode] || pAttrs[canonicalCode] || pAttrs[resolvedLabel.toLowerCase()];
                            if (val) {
                                const isVendor = attrCode === 'vendor' || canonicalCode === 'vendor' || resolvedLabel.toLowerCase() === 'vendor';
                                const btnId = isVendor ? `__vendor:products:${encodeBase64Url(val)}__` : '__nav:results__';
                                const btnTitle = isVendor ? `See ${val}'s products` : 'See products';

                                return {
                                    message: `The **${resolvedLabel}** for **${product.name || product.title}** is **${val}**.`,
                                    facet_target: resolvedLabel,
                                    options: [{ value: val, count: 1 }],
                                    scope: 'product',
                                    scope_label: product.name || targetId,
                                    source: 'state_cache',
                                    whatsapp: {
                                        type: 'button',
                                        buttons: [{ id: btnId, title: btnTitle }]
                                    }
                                };
                            }
                        }
                    }
                } catch (e) {
                    console.error('[product.facets] Cache check failed:', e.message);
                }
            }

            // ── 2. Build search params — category is already resolved by pipeline ──
            const CATS = context.CATEGORIES || CATEGORIES || {};
            const catKey = category ? Object.keys(CATS).find(k => CATS[k].id === category || CATS[k].slug === category) : null;
            const cat = catKey ? CATS[catKey] : null;
            const catLabel = cat ? cat.label : null;

            const queryStr = Array.isArray(query) ? query[0] : query;

            const searchParams = new URLSearchParams();
            searchParams.append('per_page', '1'); // We only need facets, not products
            searchParams.append('type', 'product');
            if (queryStr) searchParams.append('q', queryStr);
            if (category) searchParams.append('category_id', cat?.slug || category);
            if (targetId) searchParams.append('product_id', targetId); // Bug 1 Fix: Scope to product ID if present
            
            if (vendor) {
                const resolvedVendor = normalizeVendor(vendor);
                if (resolvedVendor) searchParams.append('tag', resolvedVendor);
            }
            // Pass through resolved attributes (e.g. attribute.b:i=infinix)
            // Stringify all values to prevent SQL type mismatches (numeric vs numeric[])
            const safeAttributes = attributes || {};
            Object.entries(safeAttributes).forEach(([key, val]) => {
                const finalVal = key === 'vendor' ? normalizeVendor(val) : String(val);
                searchParams.append(`attribute.${key}`, finalVal);
            });

            // ── 3. Call /search (same endpoint product.search uses for facets) ──
            let facetData = null;
            try {
                const result = await callBackendAPI(`/search?${searchParams.toString()}`);
                if (result?.success) {
                    facetData = result.data?.facets || null;
                }
            } catch (err) {
                console.error(`[product.facets] Search API error:`, err.message);
            }

            if (!facetData || !Array.isArray(facetData.attributes) || facetData.attributes.length === 0) {
                // Fallback: return predefined values from store context
                if (attrDef && attrDef.predefined_values && attrDef.predefined_values.length > 0) {
                    const predefined = attrDef.predefined_values.map(pv => pv.label || pv.value || pv);
                    const scopeDesc = catLabel ? ` in **${catLabel}**` : queryStr ? ` for "${queryStr}"` : '';
                    return {
                        message: `We have these **${resolvedLabel}** options${scopeDesc}: ${predefined.join(', ')}.`,
                        facet_target: resolvedLabel,
                        options: predefined.map(v => ({ value: v })),
                        scope: catLabel ? 'category' : queryStr ? 'query' : 'global',
                        scope_label: catLabel || queryStr || null,
                        source: 'predefined',
                        whatsapp: {
                            type: 'button',
                            buttons: [{ id: '__nav:results__', title: 'See products' }]
                        }
                    };
                }
                return {
                    message: `I couldn't find any specific **${resolvedLabel}** options${catLabel ? ` in ${catLabel}` : ''}${queryStr ? ` for "${queryStr}"` : ''} at the moment.`,
                    whatsapp: {
                        type: 'button',
                        buttons: [{ id: '__nav:results__', title: 'See products' }]
                    }
                };
            }

            // ── 4. Find the target attribute in backend facet response ──
            // Backend format: attributes: [{ code, label, options: [{value, count}], clauses: [...] }]
            let targetFacet = facetData.attributes.find(
                a => a.code === attrCode || a.code === canonicalCode || a.label?.toLowerCase() === resolvedLabel
            );
            if (!targetFacet) {
                targetFacet = facetData.attributes.find(
                    a => a.label?.toLowerCase()?.includes(canonicalCode) || canonicalCode?.includes(a.label?.toLowerCase())
                );
            }

            if (!targetFacet || (!targetFacet.options?.length && !targetFacet.clauses?.length)) {
                const scopeDesc = catLabel ? ` in **${catLabel}**` : queryStr ? ` for "${queryStr}"` : '';
                return {
                    message: `There are no specific **${resolvedLabel}** options${scopeDesc} at the moment.`,
                    facet_target: resolvedLabel,
                    options: [],
                    whatsapp: {
                        type: 'button',
                        buttons: [{ id: '__nav:results__', title: 'See products' }]
                    }
                };
            }

            // ── 5. Build the response with values + counts ──
            const options = (targetFacet.options || []).filter(o => o.count > 0);
            const clauses = (targetFacet.clauses || []).filter(c => c.count > 0);
            const formattedOptions = options.map(o => `${o.value} (${o.count})`).slice(0, 15);

            // Scope-aware messaging
            let scopePhrase = '';
            if (catLabel && queryStr) {
                scopePhrase = ` for "${queryStr}" in **${catLabel}**`;
            } else if (queryStr) {
                scopePhrase = ` for "${queryStr}"`;
            } else if (catLabel) {
                scopePhrase = ` in **${catLabel}**`;
            } else {
                scopePhrase = ' across all our products';
            }

            const message = `Here are the available **${targetFacet.label || resolvedLabel}** options${scopePhrase}: ${formattedOptions.join(', ')}.`;

            // WhatsApp buttons for top facet value options.
            // Use engineered tokens (__facet:select:...) so clicks bypass the intent resolver
            // entirely and map directly to product.search in the pipeline's Stage 0.
            const topOptions = options.slice(0, 3);
            const resolvedAttrCode = targetFacet.code || canonicalCode || attrCode;
            const isVendorFacet = resolvedAttrCode === 'vendor' || canonicalCode === 'vendor' || attrCode === 'vendor';
            const whatsappButtons = topOptions.map(o => {
                const encodedValue = encodeURIComponent(String(o.value));
                if (isVendorFacet) {
                    const vendorKey = encodeBase64Url(o.value);
                    return { id: `__vendor:products:${vendorKey}__`, title: `See ${o.value}'s products` };
                }
                // Include category only when one is available so the search stays scoped.
                const tokenId = category
                    ? `__facet:select:${resolvedAttrCode}:${encodedValue}:${category}__`
                    : `__facet:select:${resolvedAttrCode}:${encodedValue}__`;
                return { id: tokenId, title: `${o.value} (${o.count})` };
            });

            return {
                message,
                facet_target: targetFacet.label || resolvedLabel,
                attribute_code: resolvedAttrCode,
                options: options.map(o => ({ value: o.value, count: o.count })),
                clauses: clauses.length > 0 ? clauses.map(c => ({ label: c.label || c.name, count: c.count })) : undefined,
                scope: catLabel ? 'category' : queryStr ? 'query' : 'global',
                scope_label: catLabel || queryStr || null,
                source: 'backend_aggregation',
                whatsapp: whatsappButtons.length > 0 ? {
                    type: 'button',
                    buttons: whatsappButtons
                } : {
                    type: 'button',
                    buttons: [{ id: '__nav:results__', title: 'See products' }]
                }
            };
        }
    }
};

/**
 * Common handler to process search results (Standard, Semantic, Vector, or Similar)
 * Updates state, reference map, and builds WhatsApp UI components.
 */
/**
 * Common handler to process search results (Standard, Semantic, Vector, or Similar)
 * Updates state, reference map, and builds WhatsApp UI components.
 */
async function handleSearchResults(searchResult, params, context, snapshotId, cat, catId, isSuggestion = false) {
    const { query, limit = 5, page = 1, sort = 'relevance', attributes = {} } = params;
    const { logDebug } = require('../utils/debugLogger');

    const rawProducts = Array.isArray(searchResult.products) ? searchResult.products : [];
    const totalCount = searchResult.total ?? searchResult.pagination?.total ?? rawProducts.length;

    // 1. Extract attributes map before stripping
    const productAttrsMap = {};
    rawProducts.slice(0, 10).forEach(p => {
        const pid = p.id || p.handle || p.product_id;
        if (!pid) return;
        const attrs = { ...(p.attributes || p.metadata?.attributes || {}) };
        
        // Extract common attributes even if they aren't in metadata.attributes
        const commonAttrs = ['color', 'brand', 'size', 'storage', 'material'];
        commonAttrs.forEach(k => { if (p[k] && !attrs[k]) attrs[k] = p[k]; });

        if (Object.keys(attrs).length > 0) productAttrsMap[pid] = attrs;
    });

    // 2. Strip products for AI consumption
    const products = await processProductList(rawProducts);

    // 3. Update reference map and session state
    if (context.sessionId && products.length > 0) {
        const scope = context && context.microstate_active ? 'microstate' : 'global';
        await stateManager.updateReferenceMap(context.sessionId, products, { scope });
        
        const queryForMap = typeof query === 'string' ? query : (query?.query ?? null);
        if (queryForMap) await stateManager.updateUserQueryMap(context.sessionId, queryForMap, products);

        let existingCtx = (await stateManager.getSearchContext(context.sessionId)) || {
            product_ids: [], result_count: 0, product_attributes_map: {}, ttl_messages: 5
        };

        existingCtx.product_ids = products.slice(0, 10).map(p => p.id || p.handle || p.product_id).filter(Boolean);
        existingCtx.result_count = totalCount;
        existingCtx.product_attributes_map = { ...existingCtx.product_attributes_map, ...productAttrsMap };
        
        if (!existingCtx.category_id && catId) {
            existingCtx.category_id = catId;
            if (cat?.label) existingCtx.category = cat.label;
        }
        await stateManager.setSearchContext(context.sessionId, existingCtx);
        await stateManager.updateLastSearch(context.sessionId, query || (cat?.label ?? 'Search'), params, products, totalCount);

        const firstId = products[0].handle || products[0].id || products[0].product_id;
        await stateManager.setCurrentlyViewing(context.sessionId, firstId);
        
        // --- AMBIENT CONTEXT: Record active browsing topic ---
        let finalCatId = catId;
        let finalCatLabel = cat?.label;

        // If no explicit category was passed to the tool, infer from results
        if (!finalCatId && rawProducts.length > 0) {
            const firstProduct = rawProducts[0];
            const meta = firstProduct.metadata || {};
            if (Array.isArray(meta.category_ids) && meta.category_ids.length > 0) {
                finalCatId = meta.category_ids[0];
                finalCatLabel = Array.isArray(meta.category_names) ? meta.category_names[0] : null;
            }
        }

        await stateManager.setActiveTopic(context.sessionId, {
            type: "product",
            category_id: finalCatId || null,
            category_label: finalCatLabel || null,
            vendor: params.tag || params.attributes?.vendor || null,
            product_id: null,
            product_name: null,
            attributes: params.attributes || null
        });

        const currentState = await stateManager.getState(context.sessionId);
        await stateManager.updateState(context.sessionId, {
            session: { ...currentState.session, search_refinement_count: (currentState.session.search_refinement_count || 0) + 1 }
        });
    }

    // 4. Build WhatsApp Cards and Buttons
    const cardsPayload = buildProductCards(products.filter(Boolean));
    const facets = searchResult.facets || {};
    
    // Pagination check
    const currentPage = Number(searchResult.pagination?.page || page);
    const totalPages = Number(searchResult.pagination?.totalPages || (limit > 0 ? Math.ceil(totalCount / limit) : 1));
    const hasNextPage = currentPage < totalPages;

    const snapshotIdForFilters = Date.now().toString(36);
    let facetButtons = [];
    try {
        if (typeof buildFacetRefinerButtons === 'function') {
            const attributes = params.attributes || {};
            const refiners = buildFacetRefinerButtons({ facets, attributes, snapshotId: snapshotIdForFilters });
            facetButtons = [...(refiners.clauseButtons || []), ...(refiners.valueButtons || [])];
        } else {
            const facetsAttrs = Array.isArray(facets.attributes) ? facets.attributes : [];
            facetsAttrs.slice(0, 2).forEach(attr => {
                (attr.clauses || []).slice(0, 1).forEach(c => {
                    if (c.count > 0) facetButtons.push({ id: `__filter:clause:${snapshotId}:${attr.code}:${encodeURIComponent(c.name)}__`, title: c.label || c.name, priority: 10 });
                });
                (attr.options || []).slice(0, 1).forEach(o => {
                    if (o.count > 0) facetButtons.push({ id: `__filter:value:${snapshotId}:${attr.code}:${encodeURIComponent(String(o.value))}__`, title: String(o.value), priority: 10 });
                });
            });
        }
    } catch (_) {}

    const globalButtons = [];
    if (hasNextPage) {
        let seeMoreTitle = 'See more products';

        // Prefer vendor-specific title if searching by tag
        const tagFilter = params.tag || params.attributes?.vendor || null;
        if (tagFilter && typeof pickVendorSeeMoreTitle === 'function') {
            seeMoreTitle = pickVendorSeeMoreTitle(tagFilter);
        } else {
            // General query/category search title
            const catName = cat?.label || '';
            const clauseWords = params.clause_words || [];
            let userClause = null;
            let systemClause = null;

            if (Array.isArray(clauseWords) && clauseWords.length > 0) {
                userClause = clauseWords[0].word;
                systemClause = clauseWords[0].clauseId;
            } else {
                const attributes = params.attributes || {};
                systemClause = typeof deriveClauseNameFromAttributes === 'function' ? deriveClauseNameFromAttributes(attributes) : null;
                if (systemClause && systemClause.length <= 1) systemClause = null;
            }

            if (isSuggestion) {
                // --- SUGGESTION TIERED LABELING ---
                // Tier 1: Clause + Category suggestions
                if (userClause && catName) seeMoreTitle = `See more ${userClause} ${catName} suggestions`;
                
                // Tier 2: Category suggestions (or Clause suggestions)
                if ((!seeMoreTitle || seeMoreTitle.length > 45) && (userClause || catName)) {
                    if (catName) seeMoreTitle = `See more ${catName} suggestions`;
                    else seeMoreTitle = `See more ${userClause} suggestions`;
                }

                // Tier 3: Generic Fallback
                if (!seeMoreTitle || seeMoreTitle.length > 45) {
                    seeMoreTitle = 'See more suggestions';
                }
            } else {
                // --- STANDARD TIERED LABELING ---
                // Tier 1: User Phrasing + Category
                if (userClause && catName) seeMoreTitle = `See more ${userClause} ${catName}`;
                else if (userClause) seeMoreTitle = `See more ${userClause}`;
                else if (catName) seeMoreTitle = `See more ${catName}`;
                else seeMoreTitle = 'See more products';

                // Escalate if Tier 1 exceeds 45 characters
                if (seeMoreTitle.length > 45) {
                    // Tier 2: System Clause + Category
                    const tier2 = `See more ${systemClause} ${catName}`;
                    if (systemClause && catName && tier2.length <= 45 && systemClause !== userClause) {
                        seeMoreTitle = tier2;
                    } 
                    // Tier 3: Category only
                    else if (catName && `See more ${catName}`.length <= 45) {
                        seeMoreTitle = `See more ${catName}`;
                    } 
                    // Tier 4: Generic Fallback
                    else {
                        seeMoreTitle = 'See more products';
                    }
                }
            }
        }
        
        globalButtons.push({ id: `__nav:more:${snapshotId}__`, title: seeMoreTitle, priority: 100 });
    }

    // If exactly one product, allow immediate add to cart
    if (products.length === 1) {
        const singleId = products[0].id || products[0].handle || products[0].product_id;
        if (singleId) {
            globalButtons.push({ id: `__cart:add:${singleId}__`, title: 'Add to cart', priority: 115 });
        }
    }

    globalButtons.unshift({ id: `__nav:cards:${snapshotId}__`, title: 'See product details', priority: 110 });
    globalButtons.push(...facetButtons);

    return {
        ...searchResult,
        ...(searchResult.results ? { results: searchResult.results.map(p => ({ ...p, suppress_images: true })) } : {}),
        products: products.map(p => ({ ...p, suppress_images: true })),
        total: totalCount,
        whatsapp_product_cards: undefined, // Decoupled: Cards are now summoned purely via __nav:cards:
        whatsapp: globalButtons.length > 0 ? { type: 'button', buttons: globalButtons.slice(0, 3) } : undefined
    };
}

module.exports = productTools;
