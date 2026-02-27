/**
 * Discovery Tools
 * Advanced logic for product discovery, trending items, and personalized recommendations.
 */

const { CATEGORIES, VENDORS, COLLECTIONS } = require('../context/storeContext');
const { normalizeCategory, normalizeVendor } = require('../utils/normalization');
const { performSemanticSearch } = require('../utils/searchUtility');
const { callBackendAPI } = require('../utils/apiClient');
const stateManager = require('../state/stateManager');
const { processProductList } = require('../utils/productUtility');
const crypto = require('crypto');

const discoveryTools = {
    'discovery.ensureSuggestions': {
        description: 'Sentinel tool that shadows product searches. It verifies results and autonomously infers alternative categories if search fails or returns irrelevant items.',
        params: {
            search_intent: { type: 'string', description: 'The current specific search intent to verify (e.g. "iPhone 12 pro")' }
        },
        handler: async (params, context, accumulatedResults = []) => {
            const { search_intent } = params;
            const { queryAI } = require('../core/aiService');
            const axios = require('axios');

            // 1. Find the search result to shadow
            const searchCall = accumulatedResults.find(r => r.tool === 'product.search');
            const searchResult = searchCall ? searchCall.result : null;
            const searchProducts = searchResult?.products || [];

            console.log(`[Sentinel] Shadowing search for: "${search_intent}". Found ${searchProducts.length} results.`);

            // 2. AI Verification
            let needsRecovery = searchProducts.length === 0;

            if (!needsRecovery && searchProducts.length > 0) {
                const lowerQuery = search_intent.toLowerCase();
                const isExactMatch = searchProducts.some(p =>
                    p.name.toLowerCase().includes(lowerQuery) ||
                    lowerQuery.includes(p.name.toLowerCase())
                );

                if (isExactMatch) {
                    console.log(`[Sentinel] Fast-path Match detected for "${search_intent}". Skipping AI.`);
                    needsRecovery = false;
                } else {
                    const verificationPrompt = `Verify if the search results satisfy the user query.
USER QUERY: "${search_intent}"
SEARCH RESULTS: ${JSON.stringify(searchProducts.map(p => p.name).slice(0, 3))}

Reply "YES" if:
1. At least one result is exactly or substantially what the user asked for.
2. The user asked for a model (e.g. "iPhone 12") and that specific model is in the results.
3. The result is a highly relevant alternative that matches the specific intent.

Reply "NO" ONLY if:
1. The results are completely unrelated.
2. The results are "fuzzy" distractions that don't match the specific model/item requested.

Reply ONLY with "YES" or "NO". No other text.`;

                    try {
                        const verification = await queryAI([{ role: 'user', content: verificationPrompt }], 10, 0.1);
                        console.log(`[Sentinel] AI Relevance Verification: ${verification}`);
                        if (verification.trim().toUpperCase() === 'NO') {
                            needsRecovery = true;
                        }
                    } catch (e) {
                        console.error('[Sentinel] AI Verification failed:', e.message);
                    }
                }
            }

            if (!needsRecovery) {
                return { status: "verified", message: "Search results are relevant to intent." };
            }

            // 3. Recovery
            console.log(`[Sentinel] Entering Recovery Mode for intent: "${search_intent}"`);

            const categoryInventory = Object.values(context.CATEGORIES)
                .filter(c => c.total_count > 0 && !c.label.toLowerCase().includes('all'))
                .map(c => ({ label: c.label, slug: c.slug, inventory: c.total_count }));

            const inferencePrompt = `The user is looking for "${search_intent}" but we couldn't find a direct match.
AVAILABLE CATEGORIES (with inventory):
${JSON.stringify(categoryInventory)}

Select the MOST LOGICALLY RELATED category to offer as an alternative.
If none are related, select the most popular category.
Reply ONLY with the "slug" of the category. No other text.`;

            let suggestedCategorySlug = null;
            try {
                const inference = await queryAI([{ role: 'user', content: inferencePrompt }], 50, 0.1);
                suggestedCategorySlug = inference.trim();
                console.log(`[Sentinel] Inferred fallback category: ${suggestedCategorySlug}`);
            } catch (e) {
                console.error('[Sentinel] Inference failed:', e.message);
                suggestedCategorySlug = categoryInventory[0]?.slug;
            }

            const targetCategory = context.CATEGORIES[Object.keys(context.CATEGORIES).find(k => context.CATEGORIES[k].slug === suggestedCategorySlug)];

            if (targetCategory) {
                const BACKEND_URL = process.env.BACKEND_API_URL || 'http://localhost:3000';
                const TENANT_ID = process.env.TENANT_ID || 'cbe1df05-45ed-455a-9ce6-156b0bd45713';

                try {
                    const searchRes = await axios.get(`${BACKEND_URL}/search/products`, {
                        params: { category: targetCategory.slug, per_page: 3 },
                        headers: { 'X-Tenant-ID': TENANT_ID }
                    });

                    let rawProducts = searchRes.data.products || searchRes.data.results || [];
                    
                    // Extract attributes BEFORE processProductList (attributes are stripped)
                    const productAttrsMap = {};
                    const categoryAttrs = targetCategory?.attributes || [];
                    const commonAttrs = ['color', 'brand', 'size', 'storage', 'material'];
                    rawProducts.slice(0, 10).forEach(p => {
                        const pid = p.id || p.handle || p.product_id;
                        if (!pid) return;
                        
                        const attrs = {};
                        if (p.attributes && typeof p.attributes === 'object') {
                            Object.assign(attrs, p.attributes);
                        }
                        if (p.variants && Array.isArray(p.variants) && p.variants[0]?.attributes) {
                            Object.assign(attrs, p.variants[0].attributes);
                        }
                        commonAttrs.forEach(attrKey => {
                            if (p[attrKey] && !attrs[attrKey]) {
                                attrs[attrKey] = p[attrKey];
                            }
                        });
                        categoryAttrs.forEach(attrKey => {
                            if (p[attrKey] && !attrs[attrKey]) {
                                attrs[attrKey] = p[attrKey];
                            }
                        });
                        
                        if (Object.keys(attrs).length > 0) {
                            productAttrsMap[pid] = attrs;
                        }
                    });
                    
                    let products = await processProductList(rawProducts);

                    if (context.sessionId) {
                        await stateManager.setLastSuggestion(context.sessionId, {
                            type: 'product_offer',
                            intent: 'product.search',
                            params: { category: targetCategory.slug },
                            text: `Suggested products from ${targetCategory.label}`,
                            timestamp: new Date().toISOString()
                        });

                        if (products.length > 0) {
                            const scope = context && context.microstate_active ? 'microstate' : 'global';
                            await stateManager.updateReferenceMap(context.sessionId, products, { scope });

                            // Populate search_context with recovery product IDs, attributes map, and category
                            const existingCtx = await stateManager.getSearchContext(context.sessionId);
                            if (existingCtx) {
                                const productIds = products.slice(0, 10).map(p => p.id || p.handle || p.product_id);
                                existingCtx.product_ids = productIds;
                                existingCtx.result_count = products.length;
                                existingCtx.product_attributes_map = productAttrsMap;
                                console.log(`[DiscoveryTool] 📦 Built product_attributes_map:`, {
                                    productCount: Object.keys(productAttrsMap).length,
                                    sample: Object.keys(productAttrsMap).slice(0, 2).reduce((acc, pid) => {
                                        acc[pid] = productAttrsMap[pid];
                                        return acc;
                                    }, {}),
                                    categoryAttrs: categoryAttrs
                                });

                                // Sync suggested category
                                existingCtx.category_id = targetCategory.slug;
                                existingCtx.category = targetCategory.label;

                                await stateManager.setSearchContext(context.sessionId, existingCtx);
                            }
                        }
                    }

                    return {
                        message: `I couldn't find exactly "${search_intent}", but check out these great options from our ${targetCategory.label} collection:`,
                        products: products,
                        target_category: targetCategory.label,
                        suggestion_type: 'recovery',
                        recovery_reason: searchProducts.length > 0 ? 'irrelevant_results' : 'no_results'
                    };
                } catch (err) {
                    console.error(`[Sentinel] Failed to fetch fallback products: ${err.message}`);
                    return { error: "Failed to load suggestions" };
                }
            }

            return { message: "No suggestions found." };
        }
    },

    'discovery.sentinel': {
        description: '100% deterministic search shadow. Verifies product.search results using string matching. Falls back to category browsing when results are empty or irrelevant. No AI calls.',
        params: {
            query: { type: 'string', description: 'The discovery/browse query' },
            category: { type: 'string', description: 'Category hint (if provided)' },
            limit: { type: 'number', description: 'Max results (default 5)' },
            page: { type: 'number', description: 'Pagination page (1-indexed, default 1)' },
            sort: { type: 'string', description: 'price_asc, price_desc, date_desc, relevance' }
        },
        handler: async (params, context, accumulatedResults = []) => {
            const { query, category, limit = 5, page = 1, sort = 'relevance' } = params;

            console.log(`[Sentinel-D] Deterministic check for: "${query || category || 'browse'}"`);

            // 1. Find the search result to shadow (if product.search ran before us)
            const searchCall = accumulatedResults.find(r => r.tool === 'product.search');
            const searchProducts = searchCall?.result?.products || [];

            // 2. Deterministic Verification (string matching only)
            const { logDebug } = require('../utils/debugLogger');
            let isRelevant = false;
            if (searchProducts.length > 0 && query) {
                const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
                isRelevant = searchProducts.some(p => {
                    const name = p.name.toLowerCase();
                    return queryWords.some(w => name.includes(w)) ||
                        name.includes(query.toLowerCase());
                });
            } else if (searchProducts.length > 0 && !query) {
                // No query = general browse, results are fine
                isRelevant = true;
            }

            if (isRelevant) {
                logDebug('TOOL:SENTINEL_VERIFICATION [discovery.sentinel]', {
                    _desc: 'Sentinel verification — string-matching relevance check',
                    _example: '"gaming console" results contain "xbox/playstation/switch" → verified',
                    query,
                    productCount: searchProducts.length,
                    verified: true
                });
                console.log(`[Sentinel-D] Results verified as relevant.`);
                return { status: 'verified', message: 'Search results are relevant.' };
            }
            
            logDebug('TOOL:SENTINEL_VERIFICATION [discovery.sentinel]', {
                _desc: 'Sentinel verification — results empty or irrelevant',
                _example: '"gaming console" results do not contain console keywords → irrelevant',
                query,
                productCount: searchProducts.length,
                verified: false,
                reason: searchProducts.length === 0 ? 'no_results' : 'irrelevant'
            });

            // 3. Deterministic Recovery — find best category match
            logDebug('TOOL:RECOVERY_FALLBACK [discovery.sentinel]', {
                _desc: 'Recovery fallback — category browse when sentinel results empty/irrelevant',
                _example: '"cool gadgets" sentinel empty → fallback to browsing Gadgets collection',
                query: query || category,
                reason: searchProducts.length === 0 ? 'no_results' : 'irrelevant'
            });
            console.log(`[Sentinel-D] Entering deterministic recovery for: "${query || category}"`);

            const categories = Object.values(context.CATEGORIES || {})
                .filter(c => c.total_count > 0 && !c.label.toLowerCase().includes('all'));

            const allCats = Object.values(context.CATEGORIES || {});
            const resolveCategoryHint = (hint) => {
                if (!hint) return null;
                const h = String(hint).trim();
                if (!h) return null;
                const hLower = h.toLowerCase();

                // Try keyed access first (storeContext is keyed by category key like "smartphones")
                if (context.CATEGORIES && context.CATEGORIES[h] && context.CATEGORIES[h].id) {
                    return context.CATEGORIES[h];
                }

                // Match by ID / slug / label
                return allCats.find(c => {
                    if (!c) return false;
                    const id = String(c.id || '').toLowerCase();
                    const slug = String(c.slug || '').toLowerCase();
                    const label = String(c.label || '').toLowerCase();
                    return (id && id === hLower) || (slug && slug === hLower) || (label && label === hLower);
                }) || null;
            };

            const resolveChildCategory = (parentCat) => {
                if (!parentCat) return null;
                const children = Array.isArray(parentCat.children) ? parentCat.children : [];
                if (children.length === 0) return null;

                const childObjs = children
                    .map(k => {
                        if (context.CATEGORIES && context.CATEGORIES[k] && context.CATEGORIES[k].id) return context.CATEGORIES[k];
                        const kLower = String(k || '').toLowerCase();
                        return allCats.find(c => String(c?.id || '').toLowerCase() === kLower || String(c?.slug || '').toLowerCase() === kLower) || null;
                    })
                    .filter(Boolean);

                // Pick highest inventory child
                childObjs.sort((a, b) => (Number(b.total_count || b.product_count || 0)) - (Number(a.total_count || a.product_count || 0)));
                const best = childObjs[0] || null;
                const bestInv = best ? Number(best.total_count || best.product_count || 0) : 0;
                if (best && bestInv > 0) return best;
                return null;
            };

            const resolveParentCategory = (childCat) => {
                if (!childCat || !childCat.parent_id) return null;
                const pidLower = String(childCat.parent_id || '').toLowerCase();
                if (!pidLower) return null;
                const parent = allCats.find(c => String(c?.id || '').toLowerCase() === pidLower) || null;
                return parent;
            };

            const resolveBestSibling = (childCat, parentCat) => {
                const p = parentCat || resolveParentCategory(childCat);
                if (!p) return null;
                const siblings = Array.isArray(p.children) ? p.children : [];
                if (siblings.length === 0) return null;

                const sibObjs = siblings
                    .map(k => {
                        if (context.CATEGORIES && context.CATEGORIES[k] && context.CATEGORIES[k].id) return context.CATEGORIES[k];
                        const kLower = String(k || '').toLowerCase();
                        return allCats.find(c => String(c?.id || '').toLowerCase() === kLower || String(c?.slug || '').toLowerCase() === kLower) || null;
                    })
                    .filter(Boolean)
                    .filter(c => String(c.id || '') !== String(childCat?.id || ''));

                sibObjs.sort((a, b) => (Number(b.total_count || b.product_count || 0)) - (Number(a.total_count || a.product_count || 0)));
                const best = sibObjs[0] || null;
                const bestInv = best ? Number(best.total_count || best.product_count || 0) : 0;
                if (best && bestInv > 0) return best;
                return null;
            };

            // Score each category by word overlap
            const searchTerms = (query || category || '').toLowerCase().split(/\s+/).filter(w => w.length > 2);
            let bestCategory = null;
            let bestScore = 0;

            // If pipeline passed a specific category hint (uuid/slug/label/key), honor it.
            // If that category has no inventory, browse its best child with inventory.
            if (!query && category) {
                const hinted = resolveCategoryHint(category);
                if (hinted) {
                    const hintedInv = Number(hinted.total_count || hinted.product_count || 0);
                    if (hintedInv > 0) {
                        bestCategory = hinted;
                        bestScore = 999;
                    } else {
                        const parent = resolveParentCategory(hinted);
                        const parentInv = parent ? Number(parent.total_count || parent.product_count || 0) : 0;
                        if (parent && parentInv > 0) {
                            bestCategory = parent;
                            bestScore = 998;
                        } else {
                            const sibling = resolveBestSibling(hinted, parent);
                            if (sibling) {
                                bestCategory = sibling;
                                bestScore = 997;
                            }
                        }
                    }

                    logDebug('TOOL:SENTINEL_CATEGORY_HINT [discovery.sentinel]', {
                        _desc: 'Sentinel recovery — resolve and honor pipeline category hint (with best-child fallback)',
                        hint: category,
                        query,
                        resolved: hinted ? { id: hinted.id, label: hinted.label, slug: hinted.slug, total_count: hinted.total_count, product_count: hinted.product_count } : null,
                        chosen: bestCategory ? { id: bestCategory.id, label: bestCategory.label, slug: bestCategory.slug, total_count: bestCategory.total_count, product_count: bestCategory.product_count } : null,
                        reason: bestCategory
                            ? (bestCategory.id === hinted?.id
                                ? 'hint_category_has_inventory'
                                : (bestCategory.id === parent?.id ? 'hint_category_empty_used_parent' : 'hint_category_empty_used_best_sibling'))
                            : 'hint_not_resolved_or_no_inventory'
                    });
                }
            }

            for (const cat of categories) {
                const catWords = cat.label.toLowerCase().split(/\s+/);
                const slugWords = (cat.slug || '').split('-');
                const allCatWords = [...catWords, ...slugWords];

                let score = 0;
                for (const term of searchTerms) {
                    for (const cw of allCatWords) {
                        if (cw.includes(term) || term.includes(cw)) score += 1;
                    }
                }
                // Tie-break by inventory
                if (score > bestScore || (score === bestScore && cat.total_count > (bestCategory?.total_count || 0))) {
                    bestScore = score;
                    bestCategory = cat;
                }
            }

            // If no word overlap, pick highest-inventory category
            if (!bestCategory || bestScore === 0) {
                bestCategory = categories.sort((a, b) => b.total_count - a.total_count)[0];
            }

            if (!bestCategory) {
                return { message: 'No categories available for browsing.' };
            }

            // 4. Fetch fallback products deterministically
            try {
                const snapshotId = crypto.randomBytes(4).toString('hex');
                try {
                    if (context.sessionId) {
                        await stateManager.setSearchSnapshot(context.sessionId, snapshotId, {
                            query: query || null,
                            category: bestCategory.slug,
                            page,
                            limit,
                            sort
                        });
                    }
                } catch (_) {}

                const result = await callBackendAPI(`/search/products?category=${bestCategory.slug}&per_page=${limit}&page=${page}&sort=${encodeURIComponent(sort)}`);
                let rawProducts = result.data?.products || result.data?.results || [];
                
                // Extract attributes BEFORE processProductList (attributes are stripped)
                const productAttrsMap = {};
                const categoryAttrs = bestCategory?.attributes || [];
                const commonAttrs = ['color', 'brand', 'size', 'storage', 'material'];
                rawProducts.slice(0, 10).forEach(p => {
                    const pid = p.id || p.handle || p.product_id;
                    if (!pid) return;
                    
                    const attrs = {};
                    if (p.attributes && typeof p.attributes === 'object') {
                        Object.assign(attrs, p.attributes);
                    }
                    if (p.variants && Array.isArray(p.variants) && p.variants[0]?.attributes) {
                        Object.assign(attrs, p.variants[0].attributes);
                    }
                    commonAttrs.forEach(attrKey => {
                        if (p[attrKey] && !attrs[attrKey]) {
                            attrs[attrKey] = p[attrKey];
                        }
                    });
                    categoryAttrs.forEach(attrKey => {
                        if (p[attrKey] && !attrs[attrKey]) {
                            attrs[attrKey] = p[attrKey];
                        }
                    });
                    
                    if (Object.keys(attrs).length > 0) {
                        productAttrsMap[pid] = attrs;
                    }
                });
                
                let products = await processProductList(rawProducts);

                if (context.sessionId && products.length > 0) {
                    await stateManager.updateReferenceMap(context.sessionId, products);

                    // Populate search_context with discovery product IDs, attributes map, and category
                    const existingCtx = await stateManager.getSearchContext(context.sessionId);
                    if (existingCtx) {
                        const productIds = products.slice(0, 10).map(p => p.id || p.handle || p.product_id);
                        existingCtx.product_ids = productIds;
                        existingCtx.result_count = products.length;
                        existingCtx.product_attributes_map = productAttrsMap;
                        console.log(`[DiscoveryTool] 📦 Built product_attributes_map:`, {
                            productCount: Object.keys(productAttrsMap).length,
                            sample: Object.keys(productAttrsMap).slice(0, 2).reduce((acc, pid) => {
                                acc[pid] = productAttrsMap[pid];
                                return acc;
                            }, {}),
                            categoryAttrs: categoryAttrs
                        });

                        // Sync suggest category
                        existingCtx.category_id = bestCategory.slug;
                        existingCtx.category = bestCategory.label;

                        await stateManager.setSearchContext(context.sessionId, existingCtx);
                    }

                    await stateManager.setLastSuggestion(context.sessionId, {
                        type: 'discovery_browse',
                        intent: 'discovery.sentinel',
                        params: { category: bestCategory.slug },
                        text: `Browse ${bestCategory.label}`,
                        timestamp: new Date().toISOString()
                    });
                }

                const ordinalSuffix = (n) => {
                    if (n === 1) return 'st';
                    if (n === 2) return 'nd';
                    if (n === 3) return 'rd';
                    return 'th';
                };

                const pickedForCards = Array.isArray(products) ? products.filter(Boolean) : [];
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

                const globalButtons = [];
                if (hasNextPage) {
                    globalButtons.push({
                        id: `__nav:more:${snapshotId}__`,
                        title: 'See more',
                        priority: 100
                    });
                }

                const reason = searchProducts.length > 0 ? 'irrelevant_results' : 'no_results';
                return {
                    message: query
                        ? `I couldn't find an exact match for "${query}", but here are great options from **${bestCategory.label}**:`
                        : `Here are products from our **${bestCategory.label}** collection:`,
                    products,
                    target_category: bestCategory.label,
                    suggestion_type: 'discovery',
                    recovery_reason: reason,
                    whatsapp_product_cards: (cards.length > 0)
                        ? { type: 'button', transaction: 'product_card', cards }
                        : undefined,
                    whatsapp: (globalButtons.length > 0)
                        ? { type: 'button', buttons: globalButtons }
                        : undefined
                };
            } catch (err) {
                console.error(`[Sentinel-D] Fallback fetch failed: ${err.message}`);
                return {
                    message: `Browse our **${bestCategory.label}** collection with ${bestCategory.total_count} items!`,
                    target_category: bestCategory.label,
                    suggestion_type: 'category_hint'
                };
            }
        }
    }
};

module.exports = discoveryTools;

