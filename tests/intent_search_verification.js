/**
 * Intent-based Search Verification
 * Tests that semantic clauses are correctly resolved and passed to the search API.
 */

require('dotenv').config();
const productTools = require('../src/tools/product');
const { ATTRIBUTES, CATEGORIES } = require('../src/context/storeContext');
const { CLAUSES } = require('../src/context/clauses');

const mockContext = {
    ATTRIBUTES,
    CATEGORIES,
    userMessage: "budget gaming laptops",
    history: []
};

async function runTest() {
    console.log("=== STARTING INTENT-BASED SEARCH TEST ===");

    // Test: Search with semantic intent
    console.log("\nScenario: 'budget gaming laptops'");
    const result = await productTools['product.search'].handler({
        query: "budget gaming",
        category: "laptops"
    }, mockContext);

    // Note: This will attempt a real API call. 
    // We are looking for the "[ProductTool] Semantic enrichment added clauses" log in console
    // or observing the searchParams construction logic results.

    console.log("\n=== TEST COMPLETE ===");
}

runTest().catch(err => console.error(err));
