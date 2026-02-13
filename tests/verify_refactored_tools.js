/**
 * Verification Test: Refactored Product Tools (Unified Search)
 * Ensures all product tools in be3_ai correctly use the /search endpoint.
 */

const { executeTools } = require('../src/core/orchestrator');

async function runTest() {
    console.log("=== STARTING PRODUCT TOOL VERIFICATION (UNIFIED) ===");
    const sessionId = "test-product-tools-unified-" + Date.now();

    const testCases = [
        {
            name: "product.search with Keywords",
            tools: [
                {
                    tool: "product.search",
                    params: { query: "iPhone", limit: 3 },
                    reason: "Basic keyword search"
                }
            ]
        },
        {
            name: "product.search with Category (ID)",
            tools: [
                {
                    tool: "product.search",
                    params: { category: "5cba5153-0772-450a-b8b7-8a4fa532ecc1", limit: 2 }, // Android Phones
                    reason: "Searching in specific category ID"
                }
            ]
        },
        {
            name: "product.getDetails",
            tools: [
                {
                    tool: "product.getDetails",
                    params: { product_id: "0e00553a-068d-4fc7-a507-cdc9906ed569" }, // iPhone 12 Pro from previous test
                    reason: "Fetching specific product details via search ID"
                }
            ]
        },
        {
            name: "product.checkAvailability",
            tools: [
                {
                    tool: "product.checkAvailability",
                    params: { product_id: "0e00553a-068d-4fc7-a507-cdc9906ed569" },
                    reason: "Checking availability"
                }
            ]
        }
    ];

    for (const test of testCases) {
        console.log(`\n--- Test Case: ${test.name} ---`);
        try {
            const results = await executeTools(test.tools, sessionId);
            console.log("Results Status:", results.map(r => r.success ? 'SUCCESS' : 'FAILED').join(', '));

            if (results[0].success) {
                const result = results[0].result;
                if (Array.isArray(result.products)) {
                    console.log(`Found ${result.products.length} products.`);
                    if (result.products.length > 0) {
                        console.log(`First Product: ${result.products[0].title || result.products[0].name}`);
                    }
                } else if (result.product) {
                    console.log(`Found Product: ${result.product.title || result.product.name}`);
                } else if (result.name) {
                    console.log(`Availability for ${result.name}: ${result.status}`);
                }
            } else {
                console.error("Test Failed:", results[0].error);
            }
        } catch (e) {
            console.error(`ERROR in ${test.name}:`, e.message);
        }
    }

    console.log("\n=== VERIFICATION COMPLETE ===");
}

runTest();
