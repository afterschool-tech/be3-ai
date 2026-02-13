/**
 * Master Search Endpoint Verification Test
 * Directly tests the /search endpoint to verify its multi-filtering capabilities.
 */

const axios = require('axios');
const BACKEND_URL = process.env.BACKEND_API_URL || 'http://localhost:3000';
const TENANT_ID = process.env.TENANT_ID || 'cbe1df05-45ed-455a-9ce6-156b0bd45713';

async function testSearch(name, params) {
    const url = `${BACKEND_URL}/search`;
    console.log(`\n--- [TEST: ${name}] ---`);
    console.log(`Params: ${JSON.stringify(params)}`);

    try {
        const response = await axios.get(url, {
            params,
            headers: { 'X-Tenant-ID': TENANT_ID }
        });

        const { results, pagination, facets } = response.data;
        console.log(`Success: ${response.data.success}`);
        console.log(`Results Found: ${results.length} (Total: ${pagination.total})`);

        if (results.length > 0) {
            const first = results[0];
            console.log(`First Result: ${first.title || first.name} (Content ID: ${first.content_id})`);
            if (first.metadata) {
                console.log(`  Price: ${first.metadata.price}`);
                console.log(`  Category IDs: ${first.metadata.category_ids?.join(', ')}`);
                console.log(`  Final ID (Sanity): ${first.id}`);
            }
        }

        if (facets) {
            const facetKeys = Object.keys(facets);
            console.log(`Facets available: ${facetKeys.slice(0, 5).join(', ')}${facetKeys.length > 5 ? '...' : ''}`);
        }

    } catch (error) {
        console.error(`Error: ${error.response?.data?.error || error.message}`);
    }
}

async function runAllTests() {
    console.log("=====================================================");
    console.log("🚀 STARTING COMPREHENSIVE MASTER SEARCH VERIFICATION");
    console.log("=====================================================");

    // 1. Basic Keyword Search
    await testSearch("Keyword Search", { q: 'iPhone' });

    // 2. Category Drill-down (Smartphones ID)
    // Should resolve child categories if logic is working
    await testSearch("Category IDs", { category_id: '7b8b5bb4-7878-4203-a550-a0941e1e3eb9' });

    // 3. Dynamic Attribute Filtering (Brand = Apple)
    await testSearch("Attribute Filter (Brand)", {
        'attribute.b': 'Apple'
    });

    // 4. Combined Filtering: Category + Attribute Clause (Affordable p:p)
    await testSearch("Category + Attribute Clause", {
        category_id: '7b8b5bb4-7878-4203-a550-a0941e1e3eb9',
        'attribute.p:p': '1'
    });

    // 5. Direct ID Lookup (Unified Search Endpoint)
    await testSearch("Direct ID Lookup", { id: '2567e802-92a4-4767-bd77-e178905f7de7' });

    // 6. Price Range Filter
    await testSearch("Price Range", {
        price_min: 100,
        price_max: 5000
    });

    console.log("\n=====================================================");
    console.log("✅ MASTER SEARCH VERIFICATION COMPLETE");
    console.log("=====================================================");
}

runAllTests();
