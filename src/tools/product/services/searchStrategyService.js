const crypto = require('crypto');
const { CATEGORIES } = require('../../../context/storeContext');
const { normalizeCategory } = require('../../../utils/normalization');
const { resolveProduct } = require('../../../utils/productResolver');
const { performVectorSearch, performSimilarSearch, performImageSearch } = require('../../../utils/vectorSearchUtility');
const stateManager = require('../../../state/stateManager');
const bloomClient = require('../../../utils/bloomClient');
const { executeSearch, buildSearchSpec } = require('../../../utils/searchInterfaceClient');
const { logDebug } = require('../../../utils/debugLogger');
const { handleSearchResults } = require('../presentation/postSearchProcessor');

async function executeSearchStrategy(params, context) {
    let { query, category, is_kickstart, is_partial_match, price_min, price_max, limit = 5, page = 1, sort = 'relevance', tag, attributes = {}, search_mode, similar_to, image, clause_words, allow_deep_fallbacks = false } = params;

    // Normalize query: if it's an array, join it. Ensure it's always a string.
    if (Array.isArray(query)) {
        query = query.join(' ');
    }
    query = String(query || '').trim();

    const safeAttributes = attributes || {};

    const snapshotId = crypto.randomBytes(4).toString('hex');
    try {
        if (context.sessionId) {
            await stateManager.setSearchSnapshot(context.sessionId, snapshotId, { ...params, page });
        }
    } catch (_) { }

    let catId = normalizeCategory(category, null, false, { initiator: 'product_tool_search', debug: true });
    const catKey = catId ? Object.keys(context.CATEGORIES || {}).find(k => context.CATEGORIES[k].id === catId) : null;
    let cat = catKey ? context.CATEGORIES[catKey] : null;

    // --- STAGE 0: Partial Category Guard ---
    if (is_partial_match && (search_mode === 'VECTOR' || search_mode === 'IMAGE' || similar_to)) {
        logDebug('TOOL:PARTIAL_CATEGORY_DROPPED', {
            category: cat?.label,
            reason: 'is_partial_match active during Vector/Similarity search'
        });
        catId = null;
        cat = null;
    }

    // --- STAGE 0.2: Pure Vector / Similarity / Image Mode ---
    if (search_mode === 'VECTOR' || search_mode === 'IMAGE' || similar_to) {
        let vectorResult = null;
        let resolvedSimilarityId = null; // hoisted so annotation block can access it
        const extraParams = { page, price_min, price_max, tag, attributes: safeAttributes };

        if (search_mode === 'IMAGE' && image) {
            logDebug('TOOL:IMAGE_SEARCH_MODE [product.search]', { imageLength: image.length, limit, hasFilters: true });
            vectorResult = await performImageSearch(image, limit, catId, extraParams);

            if (!vectorResult || !vectorResult.products || vectorResult.products.length === 0) {
                return {
                    directResponse: true,
                    message: "I scanned the image, but I couldn't find any visually similar products in our store right now. Try uploading a different angle or a clearer picture! 📸"
                };
            }
        } else if (similar_to) {
            logDebug('TOOL:SIMILAR_SEARCH_MODE [product.search]', { similar_to, limit, hasFilters: true });

            const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(similar_to);
            resolvedSimilarityId = isUuid ? similar_to : await resolveProduct(similar_to, context, { category: catId });

            if (!resolvedSimilarityId) {
                logDebug('TOOL:SIMILAR_SEARCH_FAILED [product.search]', { similar_to, reason: 'unresolved' });
            } else {
                vectorResult = await performSimilarSearch(resolvedSimilarityId, limit, extraParams);

                // Fallback to unfiltered similarity if filtered returns nothing
                if (!vectorResult || vectorResult.products.length === 0) {
                    logDebug('TOOL:SIMILAR_FALLBACK_UNFILTERED [product.search]', { similar_to: resolvedSimilarityId });
                    const fallbackQuery = (params._category_words ? `${params._category_words} ${query}` : query).trim();
                    vectorResult = await performSimilarSearch(resolvedSimilarityId, limit, null, fallbackQuery); // Passing fallthrough query
                }
            }
        } else if (query) {
            logDebug('TOOL:VECTOR_SEARCH_MODE [product.search]', { query, limit, hasFilters: true });
            vectorResult = await performVectorSearch(query, limit, catId, extraParams);

            // Fallback to unfiltered vector if filtered returns nothing
            if (!vectorResult || vectorResult.products.length === 0) {
                logDebug('TOOL:VECTOR_FALLBACK_UNFILTERED [product.search]', { query });
                const fallbackQuery = (params._category_words ? `${params._category_words} ${query}` : query).trim();
                vectorResult = await performVectorSearch(fallbackQuery, limit, null); // Pass null to actually remove the category filter!
            }
        }

        if (vectorResult && vectorResult.products && vectorResult.products.length > 0) {
            const finalResult = await handleSearchResults(vectorResult, params, context, snapshotId, cat, catId);

            if (search_mode === 'IMAGE') {
                finalResult.mode = 'IMAGE';
            } else if (similar_to) {
                finalResult.mode = 'similar';
                finalResult.similar_to = resolvedSimilarityId;
                const isInputUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(similar_to);
                if (!isInputUuid) {
                    finalResult.similar_to_name = similar_to; // it was a name already
                } else {
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
                            for (const [alias, id] of Object.entries(refMap)) {
                                if (id === similar_to) { resolvedName = alias; break; }
                            }
                        }
                        if (resolvedName) finalResult.similar_to_name = resolvedName;
                    } catch (_) { }
                }
            }

            return finalResult;
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    // NEW SEARCH STRATEGY (Steps 1-4)
    // ═══════════════════════════════════════════════════════════════════

    const isQueried = query && query.trim().length > 0;
    const searchMode_label = isQueried ? 'QUERIED' : 'NON-QUERIED';

    let categoryType_label = 'none';
    if (catId) {
        if (is_partial_match) categoryType_label = 'partial';
        else if (is_kickstart) categoryType_label = 'kickstart';
        else categoryType_label = 'precision';
    }

    if (!isQueried && catId && cat) {
        const catProductCount = cat.total_count ?? 0;
        if (catProductCount === 0) {
            logDebug('TOOL:NON_QUERIED_IC_FAILED', {
                _desc: 'Non-queried inventory check — category has 0 products',
                searchMode: searchMode_label,
                categoryType: categoryType_label,
                category: cat.label,
                categoryId: catId,
                total_count: catProductCount
            });
            return {
                products: [],
                total: 0,
                message: `I don't have any products in ${cat.label || 'that category'} right now.`,
                search_classification: 'none',
                search_stage: 0,
                inventory_check_failed: true
            };
        }
    }

    const bloomTokens = (query || '').toLowerCase().split(/\s+/).filter(t => t.length > 0);
    let bloomResult = null;

    let categoryCandidates = params._category_candidates || [];
    if (categoryCandidates.length === 0 && catId) {
        categoryCandidates = [{ id: catId, slug: cat?.slug, label: cat?.label, isWinner: true, isPartial: is_partial_match || false }];
    }

    if (bloomTokens.length > 0) {
        try {
            const allCategoryIds = categoryCandidates.map(c => c.id).filter(Boolean);
            bloomResult = await bloomClient.checkBloom(bloomTokens, allCategoryIds);

            if (bloomResult.global && bloomResult.global.source !== 'fail-open') {
                if (!bloomResult.global.passed) {
                    logDebug('BLOOM:GLOBAL_MISS', {
                        _desc: 'PIE product name tokens missed global Bloom — precision search unlikely to succeed',
                        tokens: bloomTokens,
                        misses: bloomResult.global.misses
                    });
                } else {
                    logDebug('BLOOM:GLOBAL_HIT', {
                        _desc: 'PIE product name tokens found in global Bloom',
                        hits: bloomResult.global.hits,
                        misses: bloomResult.global.misses
                    });

                    if (categoryCandidates.length > 0 && bloomResult.categories) {
                        const beforeCount = categoryCandidates.length;
                        const kept = [];
                        const disqualified = [];

                        categoryCandidates = categoryCandidates.filter(c => {
                            const name = c.label || c.slug || c.id;
                            const catBloom = bloomResult.categories?.[c.id];

                            if (!catBloom || catBloom.source === 'fail-open') {
                                kept.push({ name, reason: 'no_bloom_data' });
                                return true;
                            }

                            if (catBloom.passed) {
                                kept.push({ name, reason: 'bloom_passed' });
                                return true;
                            } else {
                                disqualified.push({
                                    name,
                                    misses: catBloom.misses
                                });
                                return false;
                            }
                        });

                        if (categoryCandidates.length < beforeCount) {
                            logDebug('BLOOM:CATEGORY_FILTER', {
                                _desc: 'Per-category Bloom filtering — disqualified categories without matching tokens',
                                before: beforeCount,
                                after: categoryCandidates.length,
                                disqualifiedCount: disqualified.length,
                                kept,
                                disqualified
                            });
                        }
                    }
                }
            }
        } catch (bloomErr) {
            logDebug('BLOOM:ERROR', { error: bloomErr.message });
        }
    }

    if (categoryCandidates.length > 1 && CATEGORIES) {
        const candidateIds = new Set(categoryCandidates.map(c => c.id));
        categoryCandidates = categoryCandidates.filter(c => {
            if (c.isWinner) return true;
            const catData = Object.values(CATEGORIES).find(sc => sc.id === c.id);
            if (catData && catData.parent_id && candidateIds.has(catData.parent_id)) {
                logDebug('BLOOM:DEDUP_CHILD_REMOVED', {
                    _desc: 'Post-Bloom dedup — child removed (parent in candidate list, winner immune)',
                    child: c.label,
                    childId: c.id,
                    parentId: catData.parent_id
                });
                return false;
            }
            return true;
        });
    }

    if (categoryCandidates.length > 1 && CATEGORIES) {
        const winnerCat = categoryCandidates.find(c => c.isWinner);
        const winnerData = winnerCat ? Object.values(CATEGORIES).find(sc => sc.id === winnerCat.id) : null;
        const winnerParentId = winnerData?.parent_id || null;

        categoryCandidates.sort((a, b) => {
            if (a.isWinner) return -1;
            if (b.isWinner) return 1;

            const aData = Object.values(CATEGORIES).find(sc => sc.id === a.id);
            const bData = Object.values(CATEGORIES).find(sc => sc.id === b.id);

            const aIsSibling = winnerParentId && aData?.parent_id === winnerParentId ? 1 : 0;
            const bIsSibling = winnerParentId && bData?.parent_id === winnerParentId ? 1 : 0;
            if (aIsSibling !== bIsSibling) return bIsSibling - aIsSibling;

            const aIsParent = a.id === winnerParentId ? 1 : 0;
            const bIsParent = b.id === winnerParentId ? 1 : 0;
            if (aIsParent !== bIsParent) return bIsParent - aIsParent;

            return 0;
        });
    }

    let finalCategoryType = 'none';
    let finalCatId = null;
    if (categoryCandidates.length === 1) {
        finalCatId = categoryCandidates[0].id;
        if (categoryCandidates[0].isPartial) finalCategoryType = 'single';
        else finalCategoryType = 'single';
    } else if (categoryCandidates.length > 1) {
        finalCatId = categoryCandidates[0].id; // Winner is first
        finalCategoryType = 'multiple';
    }

    if (finalCategoryType === 'multiple') {
        categoryType_label = 'multiple';
    } else if (finalCatId) {
        if (is_partial_match) categoryType_label = 'partial';
        else if (is_kickstart) categoryType_label = 'kickstart';
        else categoryType_label = 'precision';
    }

    logDebug('TOOL:CATEGORY_CANDIDATES_FINAL', {
        _desc: 'Final category candidates after Bloom + dedup + sort',
        categoryType: categoryType_label,
        candidateCount: categoryCandidates.length,
        candidates: categoryCandidates.map(c => ({ id: c.id, label: c.label, isWinner: c.isWinner }))
    });

    const searchSpec = buildSearchSpec({
        ...params,
        query,
        category: finalCatId,
        _category_candidates: categoryCandidates,
        _category_type: finalCategoryType,
        attributes: safeAttributes,
        limit,
        page,
        sort
    }, bloomResult);

    const searchResult = await executeSearch(searchSpec);

    logDebug('TOOL:SEARCH_INTERFACE_RESULT', {
        _desc: 'SearchInterface execution complete',
        searchMode: searchMode_label,
        categoryType: categoryType_label,
        total: searchResult.total,
        stage: searchResult.stage,
        classification: searchResult.classification,
        category_used: searchResult.category_used,
        price_filter_applied: searchResult.price_filter_applied,
        price_filter_failed: searchResult.price_filter_failed,
        vector_fallback_needed: searchResult.vector_fallback_needed,
        partialFallback: searchResult.partialFallback
    });

    if (searchResult.total > 0 && searchResult.products.length > 0) {
        const finalResult = await handleSearchResults(
            {
                products: searchResult.products,
                total: searchResult.total,
                facets: searchResult.facets,
                pagination: searchResult.pagination
            },
            params, context, snapshotId, cat, catId
        );

        finalResult.search_classification = searchResult.classification;
        finalResult.search_stage = searchResult.stage;

        if (searchResult.price_filter_failed) {
            finalResult.price_filter_note = "I found products matching your search, but none in that price range. Showing the best matches instead.";
        }

        if (searchResult.classification === 'suggested' || searchResult.partialFallback) {
            return {
                ...finalResult,
                products: [],
                suggested_products: finalResult.products,
                suggested_total: searchResult.total,
                suggestion_message: "I couldn't find an exact match for your request. Here are some suggestions you might like instead.",
                whatsapp_product_cards: undefined,
                whatsapp: {
                    type: 'button',
                    buttons: [
                        { id: `__nav:cards:${snapshotId}__`, title: 'See suggestions', priority: 100 }
                    ]
                },
                is_fallback: true
            };
        }

        return finalResult;
    }

    if (!isQueried) {
        logDebug('TOOL:NON_QUERIED_EMPTY', {
            _desc: 'Non-queried search returned 0 from all stages — no vector fallback',
            searchMode: searchMode_label,
            categoryType: categoryType_label,
            category: cat?.label
        });
        return { products: [], total: 0, message: `I couldn't find any products${cat ? ` in ${cat.label}` : ''} right now.` };
    }

    if (searchResult.vector_fallback_needed && query && !search_mode && !similar_to) {
        logDebug('TOOL:VECTOR_FALLBACK [product.search]', {
            _desc: 'SearchInterface returned 0 results — falling back to vector search',
            searchMode: searchMode_label,
            query
        });

        const extraParams = { page, price_min, price_max, tag, attributes: safeAttributes };
        const fallbackQuery = (params._category_words ? `${params._category_words} ${query}` : query).trim();

        let vectorFallback = await performVectorSearch(fallbackQuery, limit, catId, extraParams);
        if (!vectorFallback || vectorFallback.products?.length === 0) {
            vectorFallback = await performVectorSearch(fallbackQuery, limit, null);
        }

        if (vectorFallback && vectorFallback.products?.length > 0) {
            const final = await handleSearchResults(vectorFallback, params, context, snapshotId, cat, catId, true);
            return {
                ...final,
                products: [],
                suggested_products: final.products,
                suggested_total: final.total,
                suggestion_message: "I couldn't find an exact match for your request. Here are some suggestions you might like instead.",
                whatsapp_product_cards: undefined,
                whatsapp: {
                    type: 'button',
                    buttons: [
                        { id: `__nav:cards:${snapshotId}__`, title: 'See suggestions', priority: 100 }
                    ]
                },
                is_fallback: true
            };
        }
    }

    return { products: [], total: 0, message: "I couldn't find any products matching your search." };
}

module.exports = {
    executeSearchStrategy
};
