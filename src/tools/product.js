/**
 * Product Tools
 * Capabilities related to product search and details.
 */

const { CATEGORIES, VENDORS } = require('../context/storeContext');
const { normalizeCategory, normalizeVendor, isOrdinalOrReferencePhrase } = require('../utils/normalization');
const { resolveProduct } = require('../utils/productResolver');
const { performSemanticSearch } = require('../utils/searchUtility');
const { callBackendAPI } = require('../utils/apiClient');
const stateManager = require('../state/stateManager');
const { processProductList } = require('../utils/productUtility');
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
            attributes: { type: 'object', description: 'Dynamic filters like { b: "Apple", color: "Red" } using attribute codes' }
        },
        handler: async (params, context) => {
            const { query, category, price_min, price_max, limit = 5, page = 1, sort = 'relevance', tag, attributes = {} } = params;

            const snapshotId = crypto.randomBytes(4).toString('hex');
            try {
                if (context.sessionId) {
                    await stateManager.setSearchSnapshot(context.sessionId, snapshotId, { ...params, page });
                }
            } catch (_) { }

            const searchParams = new URLSearchParams({
                per_page: limit,
                page: page,
                sort: sort
            });

            if (query) searchParams.append('q', query);
            if (price_min) searchParams.append('price_min', price_min);
            if (price_max) searchParams.append('price_max', price_max);
            if (tag) searchParams.append('tag', tag);

            let catId = normalizeCategory(category);

            // --- STAGE -1: Category Auto-Discovery ---
            // If no category was passed, but the query contains a category name, auto-discover it.
            // This supports semantic search even when the intent resolver follows mutual exclusivity rules.
            if (!catId && query) {
                const { logDebug } = require('../utils/debugLogger');
                // Handle query as either string or array (from products param mapping)
                const queryStr = Array.isArray(query) ? query[0] : query;
                if (!queryStr) return; // Empty array case - skip auto-discovery
                const words = queryStr.toLowerCase().split(/\s+/).filter(Boolean);
                const queryLower = queryStr.toLowerCase();
                let currentPos = 0;
                const wordPositions = words.map(w => {
                    const pos = queryLower.indexOf(w, currentPos);
                    currentPos = pos >= 0 ? pos + w.length : currentPos;
                    return pos;
                });

                const inferWords = [];
                for (let i = 0; i < words.length; i++) {
                    const word = words[i];
                    const wordIndex = wordPositions[i] >= 0 ? wordPositions[i] : -1;
                    if (isOrdinalOrReferencePhrase(word, queryLower, wordIndex)) continue;
                    const cleaned = word.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
                    if (cleaned) inferWords.push(cleaned);
                }

                const makeVariants = (w) => {
                    const out = new Set();
                    if (!w) return [];
                    out.add(w);
                    if (!w.endsWith('s')) out.add(`${w}s`);
                    if (w.endsWith('s') && w.length > 2) out.add(w.slice(0, -1));
                    if (!w.endsWith('es')) out.add(`${w}es`);
                    if (w.endsWith('es') && w.length > 3) out.add(w.slice(0, -2));
                    return Array.from(out).filter(Boolean);
                };

                const tokenize = (s) => {
                    return String(s || '')
                        .toLowerCase()
                        .split(/[\s\-_\/]+/g)
                        .map(t => t.trim())
                        .filter(Boolean);
                };

                const byId = {};
                for (const c of Object.values(context.CATEGORIES || {})) {
                    if (c && c.id) byId[c.id] = c;
                }

                const getDepth = (cat) => {
                    let depth = 0;
                    const seen = new Set();
                    let cur = cat;
                    while (cur && cur.parent_id && !seen.has(cur.parent_id)) {
                        seen.add(cur.parent_id);
                        const parent = byId[cur.parent_id];
                        if (!parent) break;
                        depth += 1;
                        cur = parent;
                        if (depth > 20) break;
                    }
                    return depth;
                };

                const invBonus = (n) => {
                    const x = Number(n || 0);
                    if (!Number.isFinite(x) || x <= 0) return 0;
                    return 8 * Math.log10(1 + x);
                };

                const scored = [];
                const categories = Object.values(context.CATEGORIES || {});
                for (const cat of categories) {
                    if (!cat) continue;
                    const label = String(cat.label || '').toLowerCase().trim();
                    const slug = String(cat.slug || '').toLowerCase().trim();
                    if (!label && !slug) continue;

                    const labelTokens = tokenize(label);
                    const slugTokens = tokenize(slug);
                    const allTokens = [...new Set([...labelTokens, ...slugTokens])];

                    const wordMatches = [];
                    for (const w of inferWords) {
                        const variants = makeVariants(w);
                        let bestTier = 0;
                        let bestTierScore = 0;
                        let bestDetails = null;

                        // Tier 4: exact query token equals whole label/slug (rare, but keep)
                        if (label === w || slug === w) {
                            bestTier = 4;
                            bestTierScore = 100;
                            bestDetails = { type: 'exact_query', word: w, variant: w };
                        }

                        for (const v of variants) {
                            // Tier 4: exact token match
                            if (bestTier < 4 && allTokens.includes(v)) {
                                bestTier = 4;
                                bestTierScore = 95;
                                bestDetails = { type: 'token_exact', word: w, variant: v };
                                break;
                            }
                        }

                        // Tier 3: compound prefix/suffix match (keeps phone->smartphone and phone->iphones strong)
                        if (bestTier < 3) {
                            for (const v of variants) {
                                for (const t of allTokens) {
                                    if (!t) continue;
                                    if (t === v) continue;
                                    if (t.startsWith(v) || t.endsWith(v)) {
                                        bestTier = 3;
                                        bestTierScore = 75;
                                        bestDetails = { type: 'token_compound', word: w, variant: v, token: t };
                                        break;
                                    }
                                }
                                if (bestTier === 3) break;
                            }
                        }

                        // Tier 2: raw substring match
                        if (bestTier < 2) {
                            for (const v of variants) {
                                if ((label && label.includes(v)) || (slug && slug.includes(v))) {
                                    bestTier = 2;
                                    bestTierScore = 35;
                                    bestDetails = { type: 'substring', word: w, variant: v };
                                    break;
                                }
                            }
                        }

                        if (bestTier > 0) {
                            wordMatches.push({ word: w, tier: bestTier, score: bestTierScore, details: bestDetails });
                        }
                    }

                    if (wordMatches.length === 0) continue;

                    wordMatches.sort((a, b) => b.score - a.score);
                    const best = wordMatches[0];
                    const top2Sum = (wordMatches[0]?.score || 0) + Math.floor((wordMatches[1]?.score || 0) * 0.35);
                    const matchedWords = wordMatches.length;
                    const coverageBonus = Math.min(20, Math.max(0, (matchedWords - 1) * 8));
                    const lexScore = top2Sum + coverageBonus;
                    const lexTier = best.tier;

                    const depth = getDepth(cat);
                    const depthBonus = Math.min(4, depth) * 6;
                    const inventoryBonus = invBonus(cat.total_count);
                    const finalScore = lexScore + depthBonus + inventoryBonus;

                    scored.push({
                        id: cat.id,
                        label: cat.label,
                        slug: cat.slug,
                        total_count: cat.total_count,
                        parent_id: cat.parent_id,
                        score: finalScore,
                        lexTier,
                        lexScore,
                        match: best.details,
                        depth,
                        bonuses: { depth: depthBonus, inventory: inventoryBonus, coverage: coverageBonus }
                    });
                }

                scored.sort((a, b) => {
                    if (b.lexTier !== a.lexTier) return b.lexTier - a.lexTier;
                    if (b.lexScore !== a.lexScore) return b.lexScore - a.lexScore;
                    if (b.depth !== a.depth) return b.depth - a.depth;
                    if (b.score !== a.score) return b.score - a.score;
                    const bl = String(b.label || '').length;
                    const al = String(a.label || '').length;
                    if (bl !== al) return bl - al;
                    return String(a.id || '').localeCompare(String(b.id || ''));
                });

                if (scored.length > 0) {
                    const winner = scored[0];
                    catId = winner.id;
                    logDebug('TOOL:CATEGORY_AUTO_DISCOVERY [product.search]', {
                        _desc: 'Category auto-discovery — competition scoring across categories',
                        query: queryStr,
                        inferWords,
                        winner: {
                            id: winner.id,
                            label: winner.label,
                            slug: winner.slug,
                            score: winner.score,
                            lexTier: winner.lexTier,
                            lexScore: winner.lexScore,
                            match: winner.match,
                            bonuses: winner.bonuses,
                            depth: winner.depth,
                            total_count: winner.total_count
                        },
                        topCandidates: scored.slice(0, 5).map(c => ({
                            id: c.id,
                            label: c.label,
                            score: c.score,
                            lexTier: c.lexTier,
                            lexScore: c.lexScore,
                            match: c.match,
                            bonuses: c.bonuses,
                            depth: c.depth,
                            total_count: c.total_count
                        }))
                    });
                    console.log(`[ProductTool] Auto-discovered category via competition: ${winner.label} (${winner.id}) score=${winner.score}`);
                }
            }

            const catKey = catId ? Object.keys(context.CATEGORIES || {}).find(k => context.CATEGORIES[k].id === catId) : null;
            const cat = catKey ? context.CATEGORIES[catKey] : null;

            if (catId) {
                searchParams.append('category', cat?.slug || catId);
            }

            // --- STAGE 0: Context-First Check ---
            if (cat && cat.total_count === 0) {
                return {
                    products: [],
                    total: 0,
                    facets: {},
                    message: `We currently don't have any products in the **${cat.label}** section.`
                };
            }

            const hasAttributeFilters = attributes && typeof attributes === 'object' && Object.keys(attributes).length > 0;
            const hasStructuredFilters = hasAttributeFilters || tag || price_min || price_max;
            const shouldUseSemantic = Number(page) === 1;

            // --- STAGE 0.5: PRECISION-FIRST SEARCH ---
            // Run the structured backend call FIRST to check if there are exact results.
            // Semantic search only fires as a fallback when precision returns 0 results.
            let precisionTotal = null;
            if (cat && shouldUseSemantic && query) {
                const { logDebug: logDbg } = require('../utils/debugLogger');
                try {
                    // Quick structured probe: ask the backend for results using exact params
                    const probeParams = new URLSearchParams({
                        per_page: 1,  // Only need 1 result to check existence
                        page: 1,
                        sort: sort
                    });
                    const queryStr = Array.isArray(query) ? query[0] : query;
                    if (queryStr) probeParams.append('q', queryStr);
                    if (price_min) probeParams.append('price_min', price_min);
                    if (price_max) probeParams.append('price_max', price_max);
                    if (tag) probeParams.append('tag', tag);
                    if (catId) probeParams.append('category_id', cat?.slug || catId);
                    probeParams.append('type', 'product');

                    const safeAttrs = attributes || {};
                    Object.entries(safeAttrs).forEach(([key, val]) => {
                        const finalVal = key === 'vendor' ? normalizeVendor(val) : val;
                        probeParams.append(`attribute.${key}`, finalVal);
                    });

                    const probeResult = await callBackendAPI(`/search?${probeParams.toString()}`);
                    if (probeResult?.success) {
                        precisionTotal = probeResult.data?.pagination?.total ?? probeResult.data?.total ?? null;
                    }

                    logDbg('TOOL:PRECISION_PROBE [product.search]', {
                        _desc: 'Precision-first probe — check structured backend for exact results before semantic fallback',
                        _example: '"cheap phones" → backend has 12 results → skip semantic search',
                        query: queryStr,
                        category: cat.label,
                        precisionTotal,
                        willUseSemantic: precisionTotal === 0 || precisionTotal === null
                    });
                } catch (_) {
                    // Probe failed — fall through to semantic as before
                }
            }

            // --- STAGE 0.5b: Semantic Search (FALLBACK only when precision returns 0) ---
            // Only run semantic/vector search when the structured backend returned NO results.
            // This prevents expensive semantic operations when precise results already exist.
            const semanticEligible = precisionTotal === 0 || precisionTotal === null;
            if (cat && shouldUseSemantic && !semanticEligible) {
                const { logDebug: logDbg2 } = require('../utils/debugLogger');
                logDbg2('TOOL:SEMANTIC_SKIPPED [product.search]', {
                    _desc: 'Semantic search SKIPPED — precision probe found results, no need for vector search',
                    _example: '"cheap phones" → backend has 12 results → semantic search entirely bypassed',
                    query: Array.isArray(query) ? query[0] : query,
                    category: cat.label,
                    precisionTotal: precisionTotal,
                    reason: 'Structured backend returned results'
                });
            }
            if (cat && shouldUseSemantic && semanticEligible) {
                const { logDebug } = require('../utils/debugLogger');
                logDebug('TOOL:SEMANTIC_SEARCH [product.search]', {
                    _desc: 'Semantic search — vector/semantic search within category',
                    _example: '"phone with good camera" → semantic match to phones tagged with camera quality',
                    query,
                    category: cat.label
                });
                const queryStr = Array.isArray(query) ? query[0] : query;
                if (queryStr) {
                    const semanticResult = await performSemanticSearch(queryStr, cat, context, callBackendAPI, limit);
                    if (semanticResult) {
                        logDebug('TOOL:SEMANTIC_SEARCH_SUCCESS [product.search]', {
                            _desc: 'Semantic search success — returned results',
                            _example: 'Found 3 products via semantic match',
                            resultCount: semanticResult.products?.length || 0
                        });

                        const semanticProducts = Array.isArray(semanticResult.products) ? semanticResult.products : [];
                        let semanticTotal = semanticResult.total ?? semanticResult.pagination?.total ?? semanticProducts.length;

                        // Complement semantic results with authoritative backend facets/pagination.
                        // This keeps UI features (clause buttons, totals) consistent with the normal search path.
                        let backendFacets = null;
                        let backendPagination = null;
                        let backendTotal = null;
                        try {
                            const facetParams = new URLSearchParams({
                                per_page: limit,
                                page: page,
                                sort: sort
                            });
                            if (queryStr) facetParams.append('q', queryStr);
                            if (price_min) facetParams.append('price_min', price_min);
                            if (price_max) facetParams.append('price_max', price_max);
                            if (tag) facetParams.append('tag', tag);
                            if (catId) facetParams.append('category', cat?.slug || catId);
                            const safeAttributes = attributes || {};
                            Object.entries(safeAttributes).forEach(([key, val]) => {
                                const finalVal = key === 'vendor' ? normalizeVendor(val) : val;
                                facetParams.append(`attribute.${key}`, finalVal);
                            });

                            // IMPORTANT: /search/products does NOT return facets. Facets live on the main /search endpoint.
                            const facetQuery = new URLSearchParams(facetParams);
                            facetQuery.delete('category');
                            if (catId) facetQuery.append('category_id', cat?.slug || catId);
                            facetQuery.append('type', 'product');
                            const metaRes = await callBackendAPI(`/search?${facetQuery.toString()}`);
                            if (metaRes?.success) {
                                backendFacets = metaRes.data?.facets || null;
                                backendPagination = metaRes.data?.pagination || null;
                                backendTotal = metaRes.data?.pagination?.total ?? metaRes.data?.total ?? null;
                            }
                        } catch (_) { }

                        if (backendTotal !== null && backendTotal !== undefined) {
                            semanticTotal = backendTotal;
                        }
                        if (backendPagination) {
                            semanticResult.pagination = backendPagination;
                        }
                        if (backendFacets) {
                            semanticResult.facets = backendFacets;
                        }

                        if (context.sessionId) {
                            if (semanticProducts.length > 0) {
                                const scope = context && context.microstate_active ? 'microstate' : 'global';
                                await stateManager.updateReferenceMap(context.sessionId, semanticProducts, { scope });
                                const queryForMap = typeof query === 'string' ? query : (query?.query ?? null);
                                if (queryForMap && queryForMap.trim()) {
                                    await stateManager.updateUserQueryMap(context.sessionId, queryForMap, semanticProducts);
                                }

                                let existingCtx = await stateManager.getSearchContext(context.sessionId);
                                if (!existingCtx) {
                                    existingCtx = {
                                        product_ids: [],
                                        result_count: 0,
                                        product_attributes_map: {},
                                        ttl_messages: 5
                                    };
                                }
                                existingCtx.product_ids = semanticProducts.slice(0, 10).map(p => p.id || p.handle || p.product_id).filter(Boolean);
                                existingCtx.result_count = semanticTotal;
                                if (!existingCtx.category_id && catId) {
                                    existingCtx.category_id = catId;
                                    if (cat && cat.label) existingCtx.category = cat.label;
                                }
                                await stateManager.setSearchContext(context.sessionId, existingCtx);
                            }

                            await stateManager.updateLastSearch(
                                context.sessionId,
                                query || category,
                                { ...params, page },
                                semanticProducts,
                                semanticTotal
                            );

                            if (semanticProducts.length > 0) {
                                const firstId = semanticProducts[0].handle || semanticProducts[0].id || semanticProducts[0].product_id;
                                await stateManager.setCurrentlyViewing(context.sessionId, firstId);
                            }
                        }

                        const ordinalSuffix = (n) => {
                            if (n === 1) return 'st';
                            if (n === 2) return 'nd';
                            if (n === 3) return 'rd';
                            return 'th';
                        };
                        const pickedForCards = semanticProducts.filter(Boolean);
                        const buildCardText = (p) => {
                            const priceText = (p.price !== undefined && p.price !== null) ? `₦${p.price}` : 'Price unavailable';
                            return `*${p.name || p.title || 'Product'}*\n💰 ${priceText}`;
                        };
                        const cards = pickedForCards.map((p, idx) => {
                            const n = idx + 1;
                            const suffix = ordinalSuffix(n);
                            const imageUrl = p.image_url || p.metadata?.image_url || null;
                            return {
                                id: p.id,
                                content_type: 'product',
                                sponsor: {
                                    type: 'product',
                                    product_id: p.id,
                                    name: p.name || p.title || null,
                                    ordinal: n
                                },
                                image_url: imageUrl,
                                text: buildCardText(p),
                                buttons: [
                                    { id: `add the ${n}${suffix} one`, title: 'Add to cart' },
                                    { id: `__product:details:${p.id}__`, title: 'More info' }
                                ]
                            };
                        });

                        const usedCategory = !!catId;
                        const currentPage = Number.isFinite(Number(semanticResult?.pagination?.page))
                            ? Number(semanticResult.pagination.page)
                            : Number(page);
                        const perPage = Number.isFinite(Number(semanticResult?.pagination?.perPage))
                            ? Number(semanticResult.pagination.perPage)
                            : Number(limit);
                        const totalCount = Number.isFinite(Number(semanticTotal)) ? Number(semanticTotal) : semanticProducts.length;
                        const totalPages = Number.isFinite(Number(semanticResult?.pagination?.totalPages))
                            ? Number(semanticResult.pagination.totalPages)
                            : (perPage > 0 ? Math.ceil(totalCount / perPage) : 1);
                        const hasNextPage = currentPage < totalPages;
                        const seeMoreEligible = hasNextPage && usedCategory;

                        // Detect whether a clause filter is currently active.
                        // Convention: attributes may include keys like "p:affordable" or values containing ":".
                        let hasActiveClause = false;
                        try {
                            for (const [k, v] of Object.entries(attributes || {})) {
                                if (typeof k === 'string' && k.includes(':')) { hasActiveClause = true; break; }
                                if (typeof v === 'string' && v.includes(':')) { hasActiveClause = true; break; }
                            }
                        } catch (_) { }

                        // Filter buttons (low priority):
                        // - before clause active: prefer explicit clauses, fallback to facet options
                        // - after clause active: use facet options only
                        const clauseButtons = [];
                        const valueButtons = [];
                        try {
                            const activeClauseByAttr = {};
                            try {
                                for (const [k, v] of Object.entries(attributes || {})) {
                                    if (!k || typeof k !== 'string') continue;
                                    if (!k.includes(':')) continue;
                                    const [attrCode, clauseName] = k.split(':');
                                    const finalAttr = String(attrCode || '').trim();
                                    const finalClause = String(clauseName || '').trim();
                                    if (!finalAttr || !finalClause) continue;
                                    activeClauseByAttr[finalAttr] = finalClause.toLowerCase();
                                }
                            } catch (_) { }

                            const activeValueByAttr = {};
                            try {
                                for (const [k, v] of Object.entries(attributes || {})) {
                                    if (!k || typeof k !== 'string') continue;
                                    if (k.includes(':')) continue;
                                    if (typeof v === 'string' && v.includes(':')) continue;
                                    if (v === undefined || v === null) continue;
                                    activeValueByAttr[k] = String(v).trim().toLowerCase();
                                }
                            } catch (_) { }

                            const facetsAttrs = Array.isArray(semanticResult?.facets?.attributes)
                                ? semanticResult.facets.attributes
                                : [];
                            const clauseCandidates = [];
                            const valueCandidates = [];
                            for (const attr of facetsAttrs) {
                                const attrCode = attr?.code;
                                if (!attrCode) continue;

                                // Prefer explicit backend clauses (count-aware)
                                const clauses = Array.isArray(attr?.clauses) ? attr.clauses : [];
                                // If this attribute already has an active clause, don't offer other clauses for it.
                                if (activeClauseByAttr[attrCode]) {
                                    continue;
                                }
                                for (const c of clauses) {
                                    const clauseName = c?.name;
                                    const title = String(c?.label || c?.name || '').trim();
                                    const count = Number.isFinite(c?.count) ? Number(c.count) : 0;
                                    if (!clauseName || !title || count <= 0) continue;
                                    clauseCandidates.push({ attrCode, clauseName, title, count });
                                }

                                // Use top attribute options as refinement filters (e.g., brand=apple)
                                // NOTE: We collect options even when clauses exist, so other facets (color, storage, etc.)
                                // can still appear after a clause becomes active.
                                const options = Array.isArray(attr?.options) ? attr.options : [];
                                for (const o of options) {
                                    const value = o?.value;
                                    const count = Number.isFinite(o?.count) ? Number(o.count) : 0;
                                    if (value === undefined || value === null || count <= 0) continue;
                                    const valueStr = String(value).trim();
                                    if (!valueStr) continue;
                                    if (activeValueByAttr[attrCode] && activeValueByAttr[attrCode] === valueStr.toLowerCase()) continue;
                                    valueCandidates.push({ attrCode, value: valueStr, title: valueStr, count });
                                }
                            }

                            const combinedCandidates = [
                                ...clauseCandidates.map(c => ({
                                    type: 'clause',
                                    attrCode: c.attrCode,
                                    clauseName: c.clauseName,
                                    title: c.title,
                                    count: c.count
                                })),
                                ...valueCandidates.map(v => ({
                                    type: 'value',
                                    attrCode: v.attrCode,
                                    value: v.value,
                                    title: v.title,
                                    count: v.count
                                }))
                            ];

                            combinedCandidates
                                .sort((a, b) => {
                                    if (b.count !== a.count) return b.count - a.count;
                                    if (a.type !== b.type) return a.type === 'clause' ? -1 : 1;
                                    return 0;
                                })
                                .slice(0, 3)
                                .forEach(item => {
                                    if (item.type === 'clause') {
                                        const encoded = encodeURIComponent(String(item.clauseName));
                                        clauseButtons.push({
                                            id: `__filter:clause:${snapshotId}:${item.attrCode}:${encoded}__`,
                                            title: item.title,
                                            priority: 10
                                        });
                                    } else {
                                        const encoded = encodeURIComponent(String(item.value));
                                        valueButtons.push({
                                            id: `__filter:value:${snapshotId}:${item.attrCode}:${encoded}__`,
                                            title: item.title,
                                            priority: 10
                                        });
                                    }
                                });
                        } catch (_) { }

                        let clauseName = null;
                        try {
                            for (const [k, v] of Object.entries(attributes || {})) {
                                if (typeof k === 'string' && k.includes(':')) {
                                    clauseName = k.split(':')[1] || null;
                                    break;
                                }
                                if (typeof v === 'string' && v.includes(':')) {
                                    clauseName = v.split(':')[0] || null;
                                    break;
                                }
                            }
                        } catch (_) { }

                        const labelQuery = Array.isArray(query)
                            ? query.join(' ').trim()
                            : (typeof query === 'string' ? query.trim() : '');
                        const labelCategory = (semanticResult.category && semanticResult.category.label)
                            ? String(semanticResult.category.label).trim()
                            : '';
                        const labelBase = labelQuery || labelCategory;
                        const seeMoreTitle = clauseName
                            ? `See more ${labelBase} (${clauseName})`
                            : `See more ${labelBase}`;

                        const globalButtons = [];
                        if (seeMoreEligible && labelBase) {
                            globalButtons.push({
                                id: `__nav:more:${snapshotId}__`,
                                title: seeMoreTitle,
                                priority: 100
                            });
                        }
                        if (usedCategory) {
                            const refiners = [...clauseButtons, ...valueButtons];
                            if (refiners.length > 0) globalButtons.push(...refiners);
                        }

                        return {
                            ...semanticResult,
                            products: semanticProducts,
                            total: semanticTotal,
                            whatsapp_product_cards: (cards.length > 0)
                                ? { type: 'button', transaction: 'product_card', cards }
                                : undefined,
                            whatsapp: (globalButtons.length > 0)
                                ? {
                                    type: 'button',
                                    buttons: globalButtons
                                }
                                : undefined
                        };
                    }
                }
            }

            // Add dynamic attributes
            const safeAttributes = attributes || {};
            Object.entries(safeAttributes).forEach(([key, val]) => {
                const finalVal = key === 'vendor' ? normalizeVendor(val) : val;
                searchParams.append(`attribute.${key}`, finalVal);
            });

            const hasAttributeFiltersForBackend = safeAttributes && typeof safeAttributes === 'object' && Object.keys(safeAttributes).length > 0;

            // IMPORTANT:
            // /search/products currently does NOT parse arbitrary attribute.* query params (it only supports vendor explicitly).
            // Clause/value filtering relies on attribute.* filters, so use the main /search endpoint when attributes are present.
            let result;
            if (hasAttributeFiltersForBackend) {
                const searchQuery = new URLSearchParams(searchParams);
                searchQuery.delete('category');
                if (catId) searchQuery.append('category_id', cat?.slug || catId);
                searchQuery.append('type', 'product');
                result = await callBackendAPI(`/search?${searchQuery.toString()}`);
            } else {
                // Call Legacy Search specialized products endpoint
                result = await callBackendAPI(`/search/products?${searchParams.toString()}`);
            }

            if (!result.success) {
                return { error: "Failed to search products", details: result.error };
            }

            // /search/products does not return facets. Fetch facets via /search so we can emit clause buttons.
            // If we already used /search, facets are already present.
            if (!hasAttributeFiltersForBackend && result?.success && !result?.data?.facets) {
                try {
                    const facetQuery = new URLSearchParams(searchParams);
                    facetQuery.delete('category');
                    if (catId) facetQuery.append('category_id', cat?.slug || catId);
                    facetQuery.append('type', 'product');
                    const facetRes = await callBackendAPI(`/search?${facetQuery.toString()}`);
                    if (facetRes?.success && facetRes?.data?.facets) {
                        result.data.facets = facetRes.data.facets;
                        // Keep totals consistent with facets/pagination when available
                        if (facetRes.data?.pagination) {
                            result.data.pagination = facetRes.data.pagination;
                        }
                        if (facetRes.data?.pagination?.total !== undefined && facetRes.data?.pagination?.total !== null) {
                            result.data.total = facetRes.data.pagination.total;
                        }
                    }
                } catch (_) { }
            }

            let rawProducts = result.data.products || result.data.results || [];

            // --- EXTRACT ATTRIBUTES BEFORE STRIPPING (attributes are removed by processProductList) ---
            const productAttrsMap = {};
            const categoryAttrs = cat?.attributes || [];
            const { logDebug } = require('../utils/debugLogger');

            // Log first raw product structure for debugging
            if (rawProducts.length > 0) {
                const firstRaw = rawProducts[0];
                console.log(`[ProductTool] 🔍 Sample RAW product structure:`, {
                    id: firstRaw.id || firstRaw.handle || firstRaw.product_id,
                    has_attributes: !!firstRaw.attributes,
                    attributes: firstRaw.attributes,
                    has_variants: !!(firstRaw.variants && firstRaw.variants.length > 0),
                    variant_attributes: firstRaw.variants?.[0]?.attributes,
                    direct_color: firstRaw.color,
                    direct_brand: firstRaw.brand,
                    all_keys: Object.keys(firstRaw).slice(0, 30)
                });
            }

            // Extract attributes from RAW products before they're stripped
            rawProducts.slice(0, 10).forEach(p => {
                const pid = p.id || p.handle || p.product_id;
                if (!pid) return;

                const attrs = {};
                // Check product.attributes first
                if (p.attributes && typeof p.attributes === 'object') {
                    Object.assign(attrs, p.attributes);
                }
                // Check product.variants[0].attributes
                if (p.variants && Array.isArray(p.variants) && p.variants[0]?.attributes) {
                    Object.assign(attrs, p.variants[0].attributes);
                }
                // Check direct product properties for common attributes (even if not in categoryAttrs)
                // This is important because color might not be in categoryAttrs but still exists
                const commonAttrs = ['color', 'brand', 'size', 'storage', 'material'];
                commonAttrs.forEach(attrKey => {
                    if (p[attrKey] && !attrs[attrKey]) {
                        attrs[attrKey] = p[attrKey];
                    }
                });
                // Check direct product properties for known category attributes
                categoryAttrs.forEach(attrKey => {
                    if (p[attrKey] && !attrs[attrKey]) {
                        attrs[attrKey] = p[attrKey];
                    }
                });

                if (Object.keys(attrs).length > 0) {
                    productAttrsMap[pid] = attrs;
                }
            });

            logDebug('TOOL:PRODUCT_ATTRIBUTES_MAP_BUILD [product.search]', {
                _desc: 'Product attributes map build — extract attributes from raw products before stripping',
                _example: 'Phone with color=white, brand=Samsung → { color: white, brand: Samsung }',
                productCount: Object.keys(productAttrsMap).length,
                sampleAttrs: Object.keys(productAttrsMap).slice(0, 2).reduce((acc, pid) => {
                    acc[pid] = productAttrsMap[pid];
                    return acc;
                }, {})
            });

            // --- DATA STRIPPING & IMAGE CACHING ---
            let products = await processProductList(rawProducts);

            let suggestedProducts = [];
            let suggestedMeta = null;

            const buildSearchCall = async (opts) => {
                const {
                    queryOverride,
                    dropQuery,
                    dropOtherFilters,
                    snapshotIdOverride
                } = opts || {};

                const sParams = new URLSearchParams({
                    per_page: limit,
                    page: page,
                    sort: sort
                });

                const finalQuery = (dropQuery ? null : (queryOverride !== undefined ? queryOverride : query));
                if (finalQuery) sParams.append('q', finalQuery);

                if (!dropOtherFilters) {
                    if (price_min) sParams.append('price_min', price_min);
                    if (price_max) sParams.append('price_max', price_max);
                    if (tag) sParams.append('tag', tag);

                    const safeAttrs = attributes || {};
                    Object.entries(safeAttrs).forEach(([key, val]) => {
                        const finalVal = key === 'vendor' ? normalizeVendor(val) : val;
                        sParams.append(`attribute.${key}`, finalVal);
                    });
                }

                if (catId) {
                    sParams.append('category', cat?.slug || catId);
                }

                let res;
                if (hasAttributeFilters) {
                    const searchQuery = new URLSearchParams(sParams);
                    searchQuery.delete('category');
                    if (catId) searchQuery.append('category_id', cat?.slug || catId);
                    searchQuery.append('type', 'product');
                    res = await callBackendAPI(`/search?${searchQuery.toString()}`);
                } else {
                    res = await callBackendAPI(`/search/products?${sParams.toString()}`);
                }

                if (!res?.success) {
                    return { success: false, res };
                }

                // --- RELAXATION HANDLING ---
                // If it was a precision probe (limit 1) but returned a relaxed result, 
                // we automatically expand to a broader set (e.g., 5) to give user better options
                if (res.is_relaxed && limit === 1) {
                    console.log(`[ProductTool] 🌊 Relaxed match detected for precision probe. Expanding results.`);
                    const expandParams = new URLSearchParams(sParams);
                    expandParams.set('per_page', 5);
                    const expandRes = hasAttributeFilters
                        ? await callBackendAPI(`/search?${expandParams.toString()}`)
                        : await callBackendAPI(`/search/products?${expandParams.toString()}`);

                    if (expandRes && expandRes.success) {
                        res = expandRes;
                    }
                }

                const sRaw = res.data.products || res.data.results || [];
                const sProducts = await processProductList(sRaw);

                const currentPage = Number.isFinite(Number(res?.data?.pagination?.page))
                    ? Number(res.data.pagination.page)
                    : Number(page);
                const perPage = Number.isFinite(Number(res?.data?.pagination?.perPage))
                    ? Number(res.data.pagination.perPage)
                    : Number(limit);
                const totalCount = Number.isFinite(Number(res?.data?.pagination?.total))
                    ? Number(res.data.pagination.total)
                    : (Number.isFinite(Number(res?.data?.total)) ? Number(res.data.total) : (Array.isArray(sProducts) ? sProducts.length : 0));
                const totalPages = Number.isFinite(Number(res?.data?.pagination?.totalPages))
                    ? Number(res.data.pagination.totalPages)
                    : (perPage > 0 ? Math.ceil(totalCount / perPage) : 1);
                const hasNextPage = currentPage < totalPages;

                if (context.sessionId && snapshotIdOverride) {
                    try {
                        await stateManager.setSearchSnapshot(context.sessionId, snapshotIdOverride, {
                            ...params,
                            page,
                            query: finalQuery || undefined,
                            price_min: dropOtherFilters ? undefined : price_min,
                            price_max: dropOtherFilters ? undefined : price_max,
                            tag: dropOtherFilters ? undefined : tag,
                            attributes: dropOtherFilters ? {} : (attributes || {})
                        });
                    } catch (_) { }
                }

                return {
                    success: true,
                    res,
                    products: sProducts,
                    meta: {
                        total: totalCount,
                        hasNextPage,
                        currentPage,
                        totalPages
                    }
                };
            };

            if (products.length === 0) {
                const { logDebug } = require('../utils/debugLogger');

                const suggestionSnapshotId = crypto.randomBytes(4).toString('hex');
                const attempt1 = await buildSearchCall({ dropQuery: true, dropOtherFilters: false, snapshotIdOverride: suggestionSnapshotId });
                if (attempt1.success && Array.isArray(attempt1.products) && attempt1.products.length > 0) {
                    suggestedProducts = attempt1.products;
                    suggestedMeta = {
                        strategy: 'retry_without_query',
                        total: attempt1.meta.total,
                        hasNextPage: attempt1.meta.hasNextPage,
                        snapshotId: suggestionSnapshotId
                    };
                    logDebug('TOOL:PRODUCT_SEARCH_FALLBACK [product.search]', {
                        _desc: 'No-result fallback — retry without query (keep filters)',
                        original: { query, category, price_min, price_max, tag, attributes },
                        fallback: { query: null },
                        suggestedCount: suggestedProducts.length,
                        total: attempt1.meta.total
                    });
                } else {
                    const attempt2 = await buildSearchCall({ dropQuery: true, dropOtherFilters: true, snapshotIdOverride: suggestionSnapshotId });
                    if (attempt2.success && Array.isArray(attempt2.products) && attempt2.products.length > 0) {
                        suggestedProducts = attempt2.products;
                        suggestedMeta = {
                            strategy: 'retry_without_query_and_filters',
                            total: attempt2.meta.total,
                            hasNextPage: attempt2.meta.hasNextPage,
                            snapshotId: suggestionSnapshotId
                        };
                        logDebug('TOOL:PRODUCT_SEARCH_FALLBACK [product.search]', {
                            _desc: 'No-result fallback — retry without query and without other filters',
                            original: { query, category, price_min, price_max, tag, attributes },
                            fallback: { query: null, price_min: null, price_max: null, tag: null, attributes: {} },
                            suggestedCount: suggestedProducts.length,
                            total: attempt2.meta.total
                        });
                    }
                }
            }

            // --- STAGE 2: Reference Mapping (Phase 8) ---
            const productsForContext = (products.length > 0) ? products : (suggestedProducts.length > 0 ? suggestedProducts : []);
            if (productsForContext.length > 0 && context.sessionId) {
                const { logDebug } = require('../utils/debugLogger');
                logDebug('TOOL:REFERENCE_MAP_UPDATE [product.search]', {
                    _desc: 'Reference map update — add product aliases (name, handle, vendor) to reference_map',
                    _example: 'Product "Rattan 2 Drawers" → keys: rattan_2_drawers, the_drawer, etc.',
                    productCount: productsForContext.length,
                    sessionId: context.sessionId
                });
                const scope = context && context.microstate_active ? 'microstate' : 'global';
                await stateManager.updateReferenceMap(context.sessionId, productsForContext, { scope });

                // Update user_query_map: Store user's query -> products found
                // This is volatile (session-only) and respects user's terminology
                const queryForMap = typeof query === 'string' ? query : (query?.query ?? null);
                if (queryForMap && queryForMap.trim()) {
                    await stateManager.updateUserQueryMap(context.sessionId, queryForMap, productsForContext);
                }

                // Populate search_context with actual product IDs, attributes map, and discovered category
                let existingCtx = await stateManager.getSearchContext(context.sessionId);

                // Create search context if it doesn't exist
                if (!existingCtx) {
                    existingCtx = {
                        product_ids: [],
                        result_count: 0,
                        product_attributes_map: {},
                        ttl_messages: 5
                    };
                }

                const productIds = productsForContext.slice(0, 10).map(p => p.id || p.handle || p.product_id);
                existingCtx.product_ids = productIds;
                existingCtx.result_count = (products.length > 0)
                    ? (result.data.pagination?.total || result.data.total || products.length)
                    : (suggestedMeta?.total || suggestedProducts.length);
                existingCtx.product_attributes_map = productAttrsMap;
                logDebug('TOOL:SEARCH_CONTEXT_UPDATE [product.search]', {
                    _desc: 'Search context update — fill product_ids and product_attributes_map',
                    _example: 'product_ids: [uuid1, uuid2], attributes_map: { uuid1: { color: white } }',
                    productIdsCount: productIds.length,
                    attributesMapSize: Object.keys(productAttrsMap).length
                });
                console.log(`[ProductTool] 📦 Built product_attributes_map:`, {
                    productCount: Object.keys(productAttrsMap).length,
                    sample: Object.keys(productAttrsMap).slice(0, 2).reduce((acc, pid) => {
                        acc[pid] = productAttrsMap[pid];
                        return acc;
                    }, {}),
                    categoryAttrs: categoryAttrs
                });

                // Sync discovered category if Turn 1 write was 'none'
                if (!existingCtx.category_id && catId) {
                    existingCtx.category_id = catId;
                    if (cat && cat.label) existingCtx.category = cat.label;
                }

                await stateManager.setSearchContext(context.sessionId, existingCtx);
            } else {
            }

            // --- STAGE 3: State Syncing (Phase 17) ---
            if (context.sessionId) {
                const totalForLast = (products.length > 0)
                    ? (result.data.pagination?.total || result.data.total || 0)
                    : (suggestedMeta?.total || 0);
                await stateManager.updateLastSearch(context.sessionId, query || category, params, productsForContext, totalForLast);

                if (productsForContext.length > 0) {
                    const firstId = productsForContext[0].handle || productsForContext[0].id || productsForContext[0].product_id;
                    await stateManager.setCurrentlyViewing(context.sessionId, firstId);
                }

                const currentState = await stateManager.getState(context.sessionId);
                const currentCount = currentState.session.search_refinement_count || 0;
                await stateManager.updateState(context.sessionId, {
                    session: { ...currentState.session, search_refinement_count: currentCount + 1 }
                });

                let learnedCategory = category;
                if (!learnedCategory && productsForContext.length > 0 && productsForContext[0].categories && productsForContext[0].categories.length > 0) {
                    learnedCategory = productsForContext[0].categories[0];
                }

                await stateManager.learnFromBehavior(context.sessionId, 'search', { query, category: learnedCategory });
            }

            // --- STAGE 4: Pagination microstate + See more button (microstates) ---
            // Eligibility: show only when nextPage exists AND category was actually used.
            const usedCategory = !!catId;
            const currentPage = Number.isFinite(Number(result?.data?.pagination?.page))
                ? Number(result.data.pagination.page)
                : Number(page);
            const perPage = Number.isFinite(Number(result?.data?.pagination?.perPage))
                ? Number(result.data.pagination.perPage)
                : Number(limit);
            const totalCount = Number.isFinite(Number(result?.data?.pagination?.total))
                ? Number(result.data.pagination.total)
                : (Number.isFinite(Number(result?.data?.total)) ? Number(result.data.total) : (Array.isArray(products) ? products.length : 0));
            const totalPages = Number.isFinite(Number(result?.data?.pagination?.totalPages))
                ? Number(result.data.pagination.totalPages)
                : (perPage > 0 ? Math.ceil(totalCount / perPage) : 1);
            const hasNextPage = currentPage < totalPages;

            // Detect whether a clause filter is currently active.
            let hasActiveClause = false;
            try {
                for (const [k, v] of Object.entries(attributes || {})) {
                    if (typeof k === 'string' && k.includes(':')) { hasActiveClause = true; break; }
                    if (typeof v === 'string' && v.includes(':')) { hasActiveClause = true; break; }
                }
            } catch (_) { }

            // Filter buttons (low priority):
            // - before clause active: prefer explicit clauses, fallback to facet options
            // - after clause active: use facet options only
            const clauseButtons = [];
            const valueButtons = [];
            try {
                const activeClauseByAttr = {};
                try {
                    for (const [k, v] of Object.entries(attributes || {})) {
                        if (!k || typeof k !== 'string') continue;
                        if (!k.includes(':')) continue;
                        const [attrCode, clauseName] = k.split(':');
                        const finalAttr = String(attrCode || '').trim();
                        const finalClause = String(clauseName || '').trim();
                        if (!finalAttr || !finalClause) continue;
                        activeClauseByAttr[finalAttr] = finalClause.toLowerCase();
                    }
                } catch (_) { }

                const activeValueByAttr = {};
                try {
                    for (const [k, v] of Object.entries(attributes || {})) {
                        if (!k || typeof k !== 'string') continue;
                        if (k.includes(':')) continue;
                        if (typeof v === 'string' && v.includes(':')) continue;
                        if (v === undefined || v === null) continue;
                        activeValueByAttr[k] = String(v).trim().toLowerCase();
                    }
                } catch (_) { }

                const facetsAttrs = Array.isArray(result?.data?.facets?.attributes)
                    ? result.data.facets.attributes
                    : [];
                const clauseCandidates = [];
                const valueCandidates = [];
                for (const attr of facetsAttrs) {
                    const attrCode = attr?.code;
                    if (!attrCode) continue;

                    // Prefer explicit backend clauses (count-aware)
                    const clauses = Array.isArray(attr?.clauses) ? attr.clauses : [];
                    // If this attribute already has an active clause, don't offer other clauses for it.
                    if (activeClauseByAttr[attrCode]) {
                        continue;
                    }
                    for (const c of clauses) {
                        const clauseName = c?.name;
                        const title = String(c?.label || c?.name || '').trim();
                        const count = Number.isFinite(c?.count) ? Number(c.count) : 0;
                        if (!clauseName || !title || count <= 0) continue;
                        clauseCandidates.push({ attrCode, clauseName, title, count });
                    }

                    // Use top attribute options as refinement filters (e.g., brand=apple)
                    // NOTE: We collect options even when clauses exist, so other facets (color, storage, etc.)
                    // can still appear after a clause becomes active.
                    const options = Array.isArray(attr?.options) ? attr.options : [];
                    for (const o of options) {
                        const value = o?.value;
                        const count = Number.isFinite(o?.count) ? Number(o.count) : 0;
                        if (value === undefined || value === null || count <= 0) continue;
                        const valueStr = String(value).trim();
                        if (!valueStr) continue;
                        if (activeValueByAttr[attrCode] && activeValueByAttr[attrCode] === valueStr.toLowerCase()) continue;
                        valueCandidates.push({ attrCode, value: valueStr, title: valueStr, count });
                    }
                }

                const combinedCandidates = [
                    ...clauseCandidates.map(c => ({
                        type: 'clause',
                        attrCode: c.attrCode,
                        clauseName: c.clauseName,
                        title: c.title,
                        count: c.count
                    })),
                    ...valueCandidates.map(v => ({
                        type: 'value',
                        attrCode: v.attrCode,
                        value: v.value,
                        title: v.title,
                        count: v.count
                    }))
                ];

                combinedCandidates
                    .sort((a, b) => {
                        if (b.count !== a.count) return b.count - a.count;
                        if (a.type !== b.type) return a.type === 'clause' ? -1 : 1;
                        return 0;
                    })
                    .slice(0, 3)
                    .forEach(item => {
                        if (item.type === 'clause') {
                            const encoded = encodeURIComponent(String(item.clauseName));
                            clauseButtons.push({
                                id: `__filter:clause:${snapshotId}:${item.attrCode}:${encoded}__`,
                                title: item.title,
                                priority: 10
                            });
                        } else {
                            const encoded = encodeURIComponent(String(item.value));
                            valueButtons.push({
                                id: `__filter:value:${snapshotId}:${item.attrCode}:${encoded}__`,
                                title: item.title,
                                priority: 10
                            });
                        }
                    });
            } catch (_) { }

            const ordinalSuffix = (n) => {
                if (n === 1) return 'st';
                if (n === 2) return 'nd';
                if (n === 3) return 'rd';
                return 'th';
            };

            // Transactional product cards (sent separately by WA layer)
            const pickedForCards = Array.isArray(productsForContext) ? productsForContext.filter(Boolean) : [];
            const buildCardText = (p) => {
                const priceText = (p.price !== undefined && p.price !== null) ? `₦${p.price}` : 'Price unavailable';
                return `*${p.name || p.title || 'Product'}*\n💰 ${priceText}`;
            };
            const cards = pickedForCards.map((p, idx) => {
                const n = idx + 1;
                const suffix = ordinalSuffix(n);
                const imageUrl = p.image_url || p.metadata?.image_url || null;
                return {
                    id: p.id,
                    content_type: 'product',
                    sponsor: {
                        type: 'product',
                        product_id: p.id,
                        name: p.name || p.title || null,
                        ordinal: n
                    },
                    image_url: imageUrl,
                    text: buildCardText(p),
                    buttons: [
                        { id: `add the ${n}${suffix} one`, title: 'Add to cart' },
                        { id: `__product:details:${p.id}__`, title: 'More info' }
                    ]
                };
            });

            // Try to detect a clause (optional, only if user explicitly activated it)
            // Heuristic: attributes key includes ':' (e.g. attribute.color:premium) or value includes ':'
            let clauseName = null;
            try {
                for (const [k, v] of Object.entries(attributes || {})) {
                    if (typeof k === 'string' && k.includes(':')) {
                        clauseName = k.split(':')[1] || null;
                        break;
                    }
                    if (typeof v === 'string' && v.includes(':')) {
                        clauseName = v.split(':')[0] || null;
                        break;
                    }
                }
            } catch (_) { }

            const labelQuery = Array.isArray(query)
                ? query.join(' ').trim()
                : (typeof query === 'string' ? query.trim() : '');
            const labelCategory = (cat && cat.label) ? String(cat.label).trim() : '';

            // Label strategy (even without category): prefer query; else category; else clause; else generic.
            const labelBase = labelQuery || labelCategory || clauseName || 'results';

            // Show See more whenever we believe there's another page (snapshot-backed paging).
            const seeMoreEligible = hasNextPage && !!labelBase;

            const seeMoreTitle = (clauseName && labelBase && labelBase !== clauseName)
                ? `See more ${labelBase} (${clauseName})`
                : `See more ${labelBase}`;

            const globalButtons = [];
            if (seeMoreEligible && labelBase) {
                globalButtons.push({
                    id: `__nav:more:${snapshotId}__`,
                    title: seeMoreTitle,
                    priority: 100
                });
            }
            if (usedCategory) {
                const refiners = [...clauseButtons, ...valueButtons];
                if (refiners.length > 0) globalButtons.push(...refiners);
            }

            const suggestionButtons = [];
            if (products.length === 0 && suggestedProducts.length > 0 && suggestedMeta?.hasNextPage && suggestedMeta?.snapshotId) {
                suggestionButtons.push({
                    id: `__nav:more:${suggestedMeta.snapshotId}__`,
                    title: 'See more',
                    priority: 100
                });
            }

            return {
                products,
                total: result.data.pagination?.total || result.data.total || 0,
                facets: result.data.facets,
                suggested_products: (products.length === 0 && suggestedProducts.length > 0) ? suggestedProducts : undefined,
                suggested_total: (products.length === 0 && suggestedProducts.length > 0) ? (suggestedMeta?.total || suggestedProducts.length) : undefined,
                suggestion_message: (products.length === 0 && suggestedProducts.length > 0)
                    ? "I couldn't find an exact match for your request. Here are some suggestions you might like instead."
                    : undefined,
                whatsapp_product_cards: (cards.length > 0)
                    ? {
                        type: 'button',
                        transaction: 'product_card',
                        cards
                    }
                    : undefined,
                whatsapp: ((globalButtons.length > 0) || (suggestionButtons.length > 0))
                    ? {
                        type: 'button',
                        buttons: [...globalButtons, ...suggestionButtons]
                    }
                    : undefined
            };
        }
    },

    'product.getDetails': {
        description: 'Get full product details including images and specs using a product ID',
        params: {
            product_id: { type: 'string', description: 'The UUID of the product' }
        },
        handler: async (params, context) => {
            const { product_id } = params;
            const resolvedId = await resolveProduct(product_id, context);
            if (!resolvedId) return { error: "Could not identify product" };

            const result = await callBackendAPI(`/products/storefront/products/${resolvedId}`);

            if (!result.success || !result.data.product) {
                return { error: `Product not found: ${resolvedId}` };
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

            if (context.sessionId && result.data.product) {
                await stateManager.setCurrentlyViewing(context.sessionId, resolvedId);
                await stateManager.learnFromBehavior(context.sessionId, 'view_product', {
                    brand: result.data.product.metadata?.attributes?.v || 'Be3 Store'
                });
            }

            const buttons = [
                { id: `__cart:add:${resolvedId}__`, title: 'Add to cart' },
                { id: `__product:compare:${resolvedId}__`, title: 'Compare' }
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
            product_ids: { type: 'array', description: 'List of product UUIDs to compare' }
        },
        handler: async (params, context) => {
            let { product_ids = [] } = params;
            if (typeof product_ids === 'string') product_ids = [product_ids];

            if (product_ids.length < 2) return { error: "Please provide at least 2 products to compare." };

            const products = [];
            for (const id of product_ids) {
                const resolvedId = await resolveProduct(id, context);
                if (resolvedId) {
                    const res = await productTools['product.getDetails'].handler({ product_id: resolvedId }, context);
                    if (!res.error) products.push(res.product);
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
    }
};

module.exports = productTools;
