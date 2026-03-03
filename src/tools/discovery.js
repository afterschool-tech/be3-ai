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
        description: 'Concierge Layer: Provides rich, data-driven collection summaries and navigation menus. Triggered when search is vague or broad.',
        params: {
            query: { type: 'string', description: 'The search query' },
            category: { type: 'string', description: 'Category hint (slug or ID)' }
        },
        handler: async (params, context) => {
            const { query, category } = params;
            const { CATEGORIES } = context;

            console.log(`[Concierge] Processing discovery for: "${query || category || 'onboarding'}"`);

            // ── 1. Category Resolution ──
            const allCats = Object.values(CATEGORIES || {});
            let targetCategory = null;

            if (category) {
                targetCategory = allCats.find(c => c.slug === category || c.id === category) || null;
            }

            if (!targetCategory && query) {
                // Fuzzy match category by query words
                const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
                let bestScore = 0;
                for (const cat of allCats) {
                    const catWords = cat.label.toLowerCase().split(/\s+/);
                    let score = queryWords.filter(w => catWords.some(cw => cw.includes(w))).length;
                    if (score > bestScore) {
                        bestScore = score;
                        targetCategory = cat;
                    }
                }
            }

            // ── 2. Scenario: Pure Onboarding or Filter-Aware Greeting ──
            if (!targetCategory) {
                const topCategories = allCats
                    .filter(c => c.total_count > 0 && !c.label.toLowerCase().includes('all'))
                    .sort((a, b) => b.total_count - a.total_count)
                    .slice(0, 5);

                const buttons = topCategories.map(c => ({
                    id: `show me ${c.label}${params.price_max ? ` under ${params.price_max}` : ''}`,
                    title: c.label
                }));

                let greeting = "Welcome! I can help you find exactly what you're looking for. Which of our main aisles would you like to explore?";
                if (params.price_max || params.price_min) {
                    greeting = `I see you're looking for great deals! Which category should we check first?`;
                }

                return {
                    message: greeting,
                    suggestion_type: 'onboarding',
                    whatsapp: { type: 'button', buttons: buttons.slice(0, 3) },
                    whatsapp_list: (buttons.length > 3) ? {
                        title: "Our Collections",
                        button: "Browse All",
                        sections: [{ title: "Popular Categories", rows: buttons.map(b => ({ id: b.id, title: b.title })) }]
                    } : null
                };
            }

            // ── 3. Scenario: Dynamic Collection Summary & Sub-category Pivots ──
            try {
                // Fetch a sample of products to gather stats
                const searchRes = await callBackendAPI(`/search/products?category=${targetCategory.slug}&per_page=15`);
                const rawProducts = searchRes.data?.products || searchRes.data?.results || [];

                // Extract Stats: Price Floor, Brands, Availability
                const brands = new Set();
                let minPrice = Infinity;
                rawProducts.forEach(p => {
                    const b = p.brand || p.metadata?.brand || p.vendor;
                    if (b) brands.add(b);
                    const price = Number(p.price || p.amount || 0);
                    if (price > 0 && price < minPrice) minPrice = price;
                });

                const brandList = Array.from(brands).slice(0, 5);
                const priceFloor = minPrice === Infinity ? null : minPrice;
                const itemsCount = targetCategory.total_count || rawProducts.length;

                // Build Metadata for Personality Layer
                const metadata = {
                    category_label: targetCategory.label,
                    item_count: itemsCount,
                    price_floor: priceFloor,
                    top_brands: brandList,
                    has_inventory: itemsCount > 0,
                    sub_categories: (targetCategory.children || []).map(id => CATEGORIES[id]?.label).filter(Boolean)
                };

                // Build Contextual Buttons
                const navigationButtons = [
                    { id: `show all ${targetCategory.label}`, title: `See All ${targetCategory.label}` }
                ];

                // Add Sub-category Pivot if available
                if (targetCategory.children && targetCategory.children.length > 0) {
                    const firstChild = CATEGORIES[targetCategory.children[0]];
                    if (firstChild) {
                        navigationButtons.push({ id: `show me ${firstChild.label}`, title: `View ${firstChild.label}` });
                    }
                }

                if (brandList.length > 0 && navigationButtons.length < 3) {
                    navigationButtons.push({ id: `filter ${targetCategory.label} by brand`, title: "Filter by Brand" });
                }

                return {
                    message: `We have a great selection of **${targetCategory.label}**!`,
                    metadata: metadata,
                    suggestion_type: 'collection_summary',
                    target_category: targetCategory.label,
                    whatsapp: { type: 'button', buttons: navigationButtons.slice(0, 3) }
                };

            } catch (err) {
                console.error(`[Concierge] Stats fetch failed: ${err.message}`);
                return {
                    message: `Explore our **${targetCategory.label}** collection!`,
                    target_category: targetCategory.label,
                    suggestion_type: 'category_hint'
                };
            }
        }
    }
};

module.exports = discoveryTools;

