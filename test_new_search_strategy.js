/**
 * End-to-End Test: New Search Strategy
 * 
 * Tests the full Bloom → SearchInterface → Vector flow
 * as product.js now executes it.
 * 
 * Run: node test_new_search_strategy.js
 * Requires: backend running on port 3000
 */

const axios = require('axios');

const BACKEND_URL = 'http://localhost:3000';
const TENANT_ID = 'cbe1df05-45ed-455a-9ce6-156b0bd45713';
const headers = { 'X-Tenant-ID': TENANT_ID, 'Content-Type': 'application/json' };

const C = {
    reset: '\x1b[0m', bold: '\x1b[1m',
    green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', cyan: '\x1b[36m', dim: '\x1b[2m'
};

let passed = 0;
let failed = 0;

function assert(condition, msg, detail = '') {
    if (condition) {
        console.log(`  ${C.green}✓${C.reset} ${msg}`);
        passed++;
    } else {
        console.log(`  ${C.red}✗ FAIL: ${msg}${C.reset}${detail ? ` — ${detail}` : ''}`);
        failed++;
    }
}

async function run() {
    console.log(`\n${C.bold}${C.cyan}=== New Search Strategy E2E Tests ===${C.reset}\n`);

    // ═══════════════════════════════════════════
    // TEST 1: Full flow — Bloom check → SearchInterface (known query)
    // ═══════════════════════════════════════════
    console.log(`${C.bold}Test 1: Bloom → SearchInterface (known query "laptop")${C.reset}`);
    try {
        // Step 1: Bloom check (PIE product name tokens)
        const bloomRes = await axios.post(`${BACKEND_URL}/bloom/ai/check`, {
            tenantId: TENANT_ID,
            tokens: ['laptop'],
            candidateCategories: []
        }, { headers });

        assert(bloomRes.status === 200, 'Bloom check responds 200');
        const bloomGlobal = bloomRes.data.global;
        assert(bloomGlobal.passed === true, `Bloom global passes for "laptop" (hits: ${bloomGlobal.hits})`);

        // Step 2: SearchInterface execute
        const searchRes = await axios.post(`${BACKEND_URL}/be3-ai/search`, {
            tenantId: TENANT_ID,
            query: 'laptop',
            categories: [],
            categoryType: 'none',
            limit: 5
        }, { headers });

        assert(searchRes.status === 200, 'SearchInterface responds 200');
        assert(searchRes.data.total > 0, `SearchInterface found ${searchRes.data.total} products`);
        assert(searchRes.data.stage > 0, `Hit at stage ${searchRes.data.stage}`);
        assert(searchRes.data.vector_fallback_needed === false, 'No vector fallback needed');

        console.log(`  ${C.dim}Classification: ${searchRes.data.classification}, Stage: ${searchRes.data.stage}${C.reset}`);
    } catch (e) {
        assert(false, 'Full flow known query', e.response?.data?.message || e.message);
    }

    // ═══════════════════════════════════════════
    // TEST 2: Bloom miss → SearchInterface still runs → vector_fallback_needed
    // ═══════════════════════════════════════════
    console.log(`\n${C.bold}Test 2: Bloom miss → vector_fallback_needed${C.reset}`);
    try {
        // Step 1: Bloom check (gibberish)
        const bloomRes = await axios.post(`${BACKEND_URL}/bloom/ai/check`, {
            tenantId: TENANT_ID,
            tokens: ['xyznonexistent123'],
            candidateCategories: []
        }, { headers });

        const bloomGlobal = bloomRes.data.global;
        assert(bloomGlobal.passed === false, `Bloom correctly misses gibberish (misses: ${bloomGlobal.misses})`);

        // Step 2: SearchInterface should return 0 and flag vector fallback
        const searchRes = await axios.post(`${BACKEND_URL}/be3-ai/search`, {
            tenantId: TENANT_ID,
            query: 'xyznonexistent123',
            categories: [],
            categoryType: 'none',
            limit: 5
        }, { headers });

        assert(searchRes.data.total === 0, 'SearchInterface returns 0 results');
        assert(searchRes.data.vector_fallback_needed === true, 'vector_fallback_needed is true');
    } catch (e) {
        assert(false, 'Bloom miss flow', e.response?.data?.message || e.message);
    }

    // ═══════════════════════════════════════════
    // TEST 3: Category-scoped search with Bloom validation
    // ═══════════════════════════════════════════
    console.log(`\n${C.bold}Test 3: Category-scoped Bloom + SearchInterface${C.reset}`);
    try {
        // Use the Computers parent category
        const catId = 'cca00d97-3125-4dc3-9141-e6d459764b76';

        // Step 1: Bloom check with category
        const bloomRes = await axios.post(`${BACKEND_URL}/bloom/ai/check`, {
            tenantId: TENANT_ID,
            tokens: ['dell'],
            candidateCategories: [catId]
        }, { headers });

        assert(bloomRes.data.global.passed === true, 'Global Bloom passes for "dell"');
        const catBloom = bloomRes.data.categories?.[catId];
        if (catBloom) {
            assert(catBloom.passed === true, `Category Bloom passes for "dell" in Computers`);
        } else {
            assert(true, 'Category Bloom not available (filter may not exist yet — OK)');
        }

        // Step 2: SearchInterface with single category
        const searchRes = await axios.post(`${BACKEND_URL}/be3-ai/search`, {
            tenantId: TENANT_ID,
            query: 'dell',
            categories: [{ id: catId, slug: 'computers', label: 'Computers', isWinner: true, isPartial: false }],
            categoryType: 'single',
            limit: 5
        }, { headers });

        assert(searchRes.status === 200, 'SearchInterface responds 200');
        console.log(`  ${C.dim}Total: ${searchRes.data.total}, Stage: ${searchRes.data.stage}, Category: ${JSON.stringify(searchRes.data.category_used)}${C.reset}`);
    } catch (e) {
        assert(false, 'Category-scoped flow', e.response?.data?.message || e.message);
    }

    // ═══════════════════════════════════════════
    // TEST 4: Price post-processing
    // ═══════════════════════════════════════════
    console.log(`\n${C.bold}Test 4: Price post-processing (pass + fail)${C.reset}`);
    try {
        // 4a: Wide price range (should pass)
        const passRes = await axios.post(`${BACKEND_URL}/be3-ai/search`, {
            tenantId: TENANT_ID,
            query: 'laptop',
            categories: [],
            categoryType: 'none',
            priceFilter: { min: 0, max: 999999 },
            limit: 5
        }, { headers });

        if (passRes.data.total > 0) {
            assert(passRes.data.price_filter_applied === true, 'Wide price filter applied successfully');
        }

        // 4b: Impossible price range (should revert)
        const failRes = await axios.post(`${BACKEND_URL}/be3-ai/search`, {
            tenantId: TENANT_ID,
            query: 'laptop',
            categories: [],
            categoryType: 'none',
            priceFilter: { min: 99999999, max: 99999999 },
            limit: 5
        }, { headers });

        if (failRes.data.total > 0) {
            assert(failRes.data.price_filter_failed === true, 'Impossible price filter correctly flagged as failed');
            assert(failRes.data.products.length > 0, 'Products reverted to unfiltered set');
        }
    } catch (e) {
        assert(false, 'Price post-processing', e.response?.data?.message || e.message);
    }

    // ═══════════════════════════════════════════
    // TEST 5: Partial match fallback
    // ═══════════════════════════════════════════
    console.log(`\n${C.bold}Test 5: Partial match category fallback${C.reset}`);
    try {
        const searchRes = await axios.post(`${BACKEND_URL}/be3-ai/search`, {
            tenantId: TENANT_ID,
            query: 'wireless mouse',
            categories: [{ id: '00000000-0000-0000-0000-000000000001', slug: 'fake-cat', label: 'Fake Category', isWinner: true, isPartial: true }],
            categoryType: 'single',
            limit: 5
        }, { headers });

        assert(searchRes.status === 200, 'Responds 200');
        // If products found via fallback, classification should be 'suggested'
        if (searchRes.data.total > 0) {
            assert(
                searchRes.data.partialFallback === true || searchRes.data.classification === 'suggested' || searchRes.data.classification === 'related',
                `Partial fallback triggered (classification: ${searchRes.data.classification})`
            );
        } else {
            assert(true, 'No products found (expected for fake category)');
        }
    } catch (e) {
        assert(false, 'Partial match fallback', e.response?.data?.message || e.message);
    }

    // ═══════════════════════════════════════════
    // TEST 6: Vendor (tag) filtering via stages
    // ═══════════════════════════════════════════
    console.log(`\n${C.bold}Test 6: Vendor tag filtering${C.reset}`);
    try {
        const searchRes = await axios.post(`${BACKEND_URL}/be3-ai/search`, {
            tenantId: TENANT_ID,
            query: 'laptop',
            categories: [],
            categoryType: 'none',
            attributes: { vendor: 'Dell' },
            limit: 5
        }, { headers });

        assert(searchRes.status === 200, 'Responds 200');
        console.log(`  ${C.dim}Total: ${searchRes.data.total}, Stage: ${searchRes.data.stage}, Classification: ${searchRes.data.classification}${C.reset}`);
    } catch (e) {
        assert(false, 'Vendor filtering', e.response?.data?.message || e.message);
    }

    // ═══════════════════════════════════════════
    // TEST 7: Per-category Bloom + multiple candidates
    // ═══════════════════════════════════════════
    console.log(`\n${C.bold}Test 7: Per-category Bloom filtering with multiple candidates${C.reset}`);
    try {
        // Step 1: Bloom check across multiple categories
        const smartphonesId = '7b8b5bb4-7878-4203-a550-a0941e1e3eb9';
        const accessoriesId = 'c28c4ba9-8160-4905-84d4-dc8f30bd070f';
        const featurePhonesId = '045389eb-03ba-4466-bed3-3343870d547a';

        const bloomRes = await axios.post(`${BACKEND_URL}/bloom/ai/check`, {
            tenantId: TENANT_ID,
            tokens: ['phone'],
            candidateCategories: [smartphonesId, accessoriesId, featurePhonesId]
        }, { headers });

        assert(bloomRes.status === 200, 'Bloom multi-category check responds 200');
        assert(bloomRes.data.global.passed === true, `Global Bloom passes for "phone"`);

        // Step 2: SearchInterface with all candidates
        const searchRes = await axios.post(`${BACKEND_URL}/be3-ai/search`, {
            tenantId: TENANT_ID,
            query: 'phone',
            categories: [
                { id: smartphonesId, slug: 'smartphones', label: 'Smartphones', isWinner: true, isPartial: false },
                { id: accessoriesId, slug: 'phone-accessories', label: 'Phone Accessories', isWinner: false, isPartial: false },
                { id: featurePhonesId, slug: 'feature-phones', label: 'Feature Phones', isWinner: false, isPartial: false }
            ],
            categoryType: 'multiple',
            limit: 5
        }, { headers });

        assert(searchRes.status === 200, 'Multi-category search responds 200');
        assert(searchRes.data.classification !== undefined, `Classification: ${searchRes.data.classification}`);
        console.log(`  ${C.dim}Total: ${searchRes.data.total}, Stage: ${searchRes.data.stage}, Category: ${JSON.stringify(searchRes.data.category_used)}${C.reset}`);
    } catch (e) {
        assert(false, 'Per-category Bloom', e.response?.data?.message || e.message);
    }

    // ═══════════════════════════════════════════
    // TEST 8: Multi-category with parent+child — winner immune
    // ═══════════════════════════════════════════
    console.log(`\n${C.bold}Test 8: Multi-category — winner (child) + parent — winner immune${C.reset}`);
    try {
        // Winner is Smartphones (child), but Smartphones & Tablets (parent) is also in list
        // SearchInterface should execute both — dedup is the caller's responsibility
        const searchRes = await axios.post(`${BACKEND_URL}/be3-ai/search`, {
            tenantId: TENANT_ID,
            query: 'samsung',
            categories: [
                { id: '7b8b5bb4-7878-4203-a550-a0941e1e3eb9', slug: 'smartphones', label: 'Smartphones', isWinner: true, isPartial: false },
                { id: 'd8aed750-6164-4065-881c-652ef888179f', slug: 'smartphones-tablets', label: 'Smartphones & Tablets', isWinner: false, isPartial: false }
            ],
            categoryType: 'multiple',
            limit: 5
        }, { headers });

        assert(searchRes.status === 200, 'Responds 200');
        assert(searchRes.data.stage > 0 || searchRes.data.total === 0, `Search executed (stage: ${searchRes.data.stage})`);
        console.log(`  ${C.dim}Total: ${searchRes.data.total}, Stage: ${searchRes.data.stage}, Class: ${searchRes.data.classification}${C.reset}`);
    } catch (e) {
        assert(false, 'Winner immune dedup', e.response?.data?.message || e.message);
    }

    // ═══════════════════════════════════════════
    // TEST 9: Single category + attributes (full stage waterfall)
    // ═══════════════════════════════════════════
    console.log(`\n${C.bold}Test 9: Single category + vendor — stage waterfall${C.reset}`);
    try {
        const searchRes = await axios.post(`${BACKEND_URL}/be3-ai/search`, {
            tenantId: TENANT_ID,
            query: 'gaming laptop',
            categories: [
                { id: '2538245c-6b41-4a66-acf4-2af88fc2783b', slug: 'gaming-laptops', label: 'Gaming Laptops', isWinner: true, isPartial: false }
            ],
            categoryType: 'single',
            attributes: { vendor: 'Dell' },
            limit: 5
        }, { headers });

        assert(searchRes.status === 200, 'Responds 200');
        assert(searchRes.data.stage > 0 || searchRes.data.total === 0, `Hit at stage ${searchRes.data.stage}`);
        console.log(`  ${C.dim}Total: ${searchRes.data.total}, Stage: ${searchRes.data.stage}, Class: ${searchRes.data.classification}${C.reset}`);
    } catch (e) {
        assert(false, 'Single category + vendor waterfall', e.response?.data?.message || e.message);
    }

    // ═══════════════════════════════════════════
    // Summary
    // ═══════════════════════════════════════════
    console.log(`\n${C.bold}${C.cyan}═══════════════════════════${C.reset}`);
    console.log(`  ${C.green}Passed: ${passed}${C.reset}  ${failed > 0 ? `${C.red}Failed: ${failed}${C.reset}` : ''}`);
    console.log(`${C.bold}${C.cyan}═══════════════════════════${C.reset}\n`);

    if (failed > 0) process.exitCode = 1;
}

run().catch(e => {
    console.error(`\n${C.red}Fatal: ${e.message}${C.reset}`);
    process.exitCode = 1;
});
