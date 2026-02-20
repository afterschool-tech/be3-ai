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
                            await stateManager.updateReferenceMap(context.sessionId, products);

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
            category: { type: 'string', description: 'Category hint (if provided)' }
        },
        handler: async (params, context, accumulatedResults = []) => {
            const { query, category } = params;

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

            // Score each category by word overlap
            const searchTerms = (query || category || '').toLowerCase().split(/\s+/).filter(w => w.length > 2);
            let bestCategory = null;
            let bestScore = 0;

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
                const result = await callBackendAPI(`/search/products?category=${bestCategory.slug}&per_page=5`);
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

                const reason = searchProducts.length > 0 ? 'irrelevant_results' : 'no_results';
                return {
                    message: query
                        ? `I couldn't find an exact match for "${query}", but here are great options from **${bestCategory.label}**:`
                        : `Here are products from our **${bestCategory.label}** collection:`,
                    products,
                    target_category: bestCategory.label,
                    suggestion_type: 'discovery',
                    recovery_reason: reason
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

