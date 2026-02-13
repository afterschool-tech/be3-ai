/**
 * Discovery Tools
 * Advanced logic for product discovery, trending items, and personalized recommendations.
 */

const { CATEGORIES, VENDORS, COLLECTIONS } = require('../context/storeContext');

const discoveryTools = {
    'discovery.getTrending': {
        description: 'Get trending categories and popular items based on inventory volume.',
        params: {
            limit: { type: 'number', description: 'Number of categories to return (default 3)' }
        },
        handler: async (params, context) => {
            const limit = params.limit || 3;

            // Logic: Sort categories by total_count (inventory volume)
            const topCategories = Object.values(context.CATEGORIES)
                .filter(c => c.total_count > 0 && !c.label.toLowerCase().includes('all'))
                .sort((a, b) => b.total_count - a.total_count)
                .slice(0, limit);

            return {
                message: "Here are some of our most popular categories right now:",
                trending: topCategories.map(c => ({
                    label: c.label,
                    slug: c.slug
                })),
                tip: "You can ask for products in any of these categories!"
            };
        }
    },

    'discovery.getSuggestions': {
        description: 'Get randomized or curated suggestions to help users explore the store. Use this for "What else do you have?" or as a fallback when a search yields no results.',
        params: {
            focus: { type: 'string', description: 'Optional focus: "categories", "vendors", or "products"' },
            category_hint: { type: 'string', description: 'Optional category slug to suggest from' },
            failing_query: { type: 'string', description: 'Optional query that returned no results' }
        },
        handler: async (params, context) => {
            const { focus = 'categories', category_hint, failing_query } = params;
            const stateManager = require('../state/stateManager');

            // 1. Transactional Suggestion logic (If search failed)
            if (failing_query || category_hint) {
                console.log(`[Discovery] Handling suggestion for ${failing_query || category_hint}`);

                // Find target category
                let targetCategory = null;
                if (category_hint) {
                    targetCategory = Object.values(context.CATEGORIES).find(c => c.slug === category_hint || c.label.toLowerCase() === category_hint.toLowerCase());
                }

                // If no specific category, or it's empty, find related ones with inventory
                if (!targetCategory || targetCategory.total_count === 0) {
                    const inventoriedCategories = Object.values(context.CATEGORIES)
                        .filter(c => c.total_count > 0 && !c.label.toLowerCase().includes('all'))
                        .sort(() => 0.5 - Math.random());

                    targetCategory = inventoriedCategories[0];
                }

                if (targetCategory) {
                    // Get some products from this category to suggest
                    const axios = require('axios');
                    const BACKEND_URL = process.env.BACKEND_API_URL || 'http://localhost:3000';
                    const TENANT_ID = process.env.TENANT_ID || 'cbe1df05-45ed-455a-9ce6-156b0bd45713';

                    try {
                        const searchRes = await axios.get(`${BACKEND_URL}/search/products`, {
                            params: { category: targetCategory.slug, per_page: 3 },
                            headers: { 'X-Tenant-ID': TENANT_ID }
                        });

                        const products = searchRes.data.products || searchRes.data.results || [];

                        // TRACK SUGGESTION IN STATE
                        if (context.sessionId) {
                            await stateManager.setLastSuggestion(context.sessionId, {
                                type: 'product_offer',
                                intent: 'product.search',
                                params: { category: targetCategory.slug },
                                text: `Suggested products from ${targetCategory.label}`,
                                timestamp: new Date().toISOString()
                            });

                            // Also update reference map so user can say "the first one"
                            if (products.length > 0) {
                                await stateManager.updateReferenceMap(context.sessionId, products);
                            }
                        }

                        return {
                            message: failing_query
                                ? `I couldn't find exactly "${failing_query}", but you might be interested in our ${targetCategory.label} collection:`
                                : `Check out these items from our ${targetCategory.label} section:`,
                            products: products.map(p => ({
                                id: p.id,
                                name: p.name,
                                price: p.price,
                                image_url: p.image_url
                            })),
                            target_category: targetCategory.label,
                            suggestion_type: 'recovery'
                        };
                    } catch (err) {
                        console.error(`[Discovery] Failed to fetch fallback products: ${err.message}`);
                    }
                }
            }

            // 2. Default Discovery logic
            if (focus === 'vendors') {
                const randomVendors = Object.values(context.VENDORS)
                    .sort(() => 0.5 - Math.random())
                    .slice(0, 3);
                return {
                    message: "Check out these featured shops:",
                    suggestions: randomVendors.map(v => ({ name: v.name || v.business_name, product_count: v.product_count }))
                };
            }

            // Default: Categories
            const suggestions = Object.values(context.CATEGORIES)
                .filter(c => c.total_count > 0 && c.parent_id) // Prefer subcategories
                .sort(() => 0.5 - Math.random())
                .slice(0, 3);

            return {
                message: "Not sure where to start? Explore these sections:",
                suggestions: suggestions.map(c => ({ label: c.label, slug: c.slug }))
            };
        }
    },

    'discovery.ensureSuggestions': {
        description: 'Sentinel tool that shadows product searches. It verifies results and autonomously infers alternative categories if search fails or returns irrelevant items.',
        params: {
            search_intent: { type: 'string', description: 'The current specific search intent to verify (e.g. "iPhone 12 pro")' }
        },
        handler: async (params, context, accumulatedResults = []) => {
            const { search_intent } = params;
            const stateManager = require('../state/stateManager');
            const { queryAI } = require('../core/aiService');
            const axios = require('axios');

            // 1. Find the search result to shadow
            const searchCall = accumulatedResults.find(r => r.tool === 'product.search');
            const searchResult = searchCall ? searchCall.result : null;
            const searchProducts = searchResult?.products || [];

            console.log(`[Sentinel] Shadowing search for: "${search_intent}". Found ${searchProducts.length} results.`);

            // 2. AI Verification: Are these results actually relevant?
            let needsRecovery = searchProducts.length === 0;

            if (!needsRecovery && searchProducts.length > 0) {
                // Fast-path: If the query is literally inside any result name, it's a match.
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
1. The results are completely unrelated (e.g. searching for "hoverboard" and getting "keyboards").
2. The results are "fuzzy" distractions that don't match the specific model/item requested (e.g. searching for "iPhone 7" and ONLY finding "iPhone 13").

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

            // 3. Recovery: Autonomous Category Inference
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
                suggestedCategorySlug = categoryInventory[0]?.slug; // Fallback to first available
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

                    const products = searchRes.data.products || searchRes.data.results || [];

                    // TRACK SUGGESTION IN STATE
                    if (context.sessionId) {
                        await stateManager.setLastSuggestion(context.sessionId, {
                            type: 'product_offer',
                            intent: 'product.search',
                            params: { category: targetCategory.slug },
                            text: `Suggested products from ${targetCategory.label}`,
                            timestamp: new Date().toISOString()
                        });

                        // Update reference map
                        if (products.length > 0) {
                            await stateManager.updateReferenceMap(context.sessionId, products);
                        }
                    }

                    return {
                        message: `I couldn't find exactly "${search_intent}", but check out these great options from our ${targetCategory.label} collection:`,
                        products: products.map(p => ({
                            id: p.id,
                            name: p.name,
                            price: p.price,
                            image_url: p.image_url
                        })),
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

    'discovery.getPersonalized': {
        description: 'Get personalized recommendations based on the current session history.',
        params: {},
        handler: async (params, context) => {
            // This tool ideally reads from StateManager, but context.sessionId is passed.
            // For now, we utilize the 'product_context' if available in the broader context 
            // sequence (if we had a way to pass state here).

            // Fallback: Use highly populated child categories related to top-level ones.
            return {
                message: "Based on store highlights, you might like these:",
                recommendations: [
                    { label: "New Arrivals", description: "Our latest additions" },
                    { label: "Best Sellers", description: "Most popular items this week" }
                ],
                action: "Would you like to see products from any of these?"
            };
        }
    }
};

module.exports = discoveryTools;
