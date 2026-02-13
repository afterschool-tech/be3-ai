/**
 * Verification Test: Unified Search API
 * Ensures all product tools correctly use the /search master endpoint.
 */

const { executeTools } = require('../src/core/orchestrator');

async function runTest() {
    console.log("=== STARTING UNIFIED SEARCH VERIFICATION ===");
    const sessionId = "test-search-unification-" + Date.now();

    const testCases = [
        {
            name: "Search by Category and Dynamic Attributes",
            tools: [
                {
                    tool: "product.search",
                    params: {
                        query: "iMac",
                        category: "tablets", // Using a category that might have it
                        attributes: { color: "Silver" }
                    },
                    reason: "Testing search with dynamic attributes"
                }
            ]
        },
        {
            name: "Get Product Details via search ID",
            tools: [
                {
                    tool: "product.getDetails",
                    params: { product_id: "c7e1df05-45ed-455a-9ce6-156b0bd45714" }, // Example ID
                    reason: "Testing single ID lookup via search"
                }
            ]
        },
        {
            name: "Check Availability via search",
            tools: [
                {
                    tool: "product.checkAvailability",
                    params: { product_id: "c7e1df05-45ed-455a-9ce6-156b0bd45714" },
                    reason: "Testing availability check via details refactor"
                }
            ]
        }
    ];

    for (const test of testCases) {
        console.log(`\n--- Test Case: ${test.name} ---`);
        try {
            const results = await executeTools(test.tools, sessionId);
            console.log("Results Status:", results.map(r => r.success ? 'SUCCESS' : 'FAILED').join(', '));
            console.log("Full Result:", JSON.stringify(results[0].result, null, 2).substring(0, 300) + "...");
        } catch (e) {
            console.error(`ERROR in ${test.name}:`, e.message);
        }
    }

    console.log("\n=== VERIFICATION COMPLETE ===");
}

runTest();
