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

                    let products = searchRes.data.products || searchRes.data.results || [];
                    products = await processProductList(products);

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
    }
};

module.exports = discoveryTools;
