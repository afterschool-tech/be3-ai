/**
 * Product Resolution Verification
 * Tests name-to-ID fallback and state-based resolution.
 */

require('dotenv').config();
const productTools = require('../src/tools/product');
const stateManager = require('../state/stateManager');

const mockContext = {
    sessionId: 'test-session-' + Date.now(),
    history: []
};

async function runTest() {
    console.log("=== STARTING PRODUCT RESOLUTION TEST ===");

    // Scenario 1: Resolve by name (fallback to search)
    // We'll search for "iPhone" (assuming it exists in the test DB)
    console.log("\nScenario 1: Resolve 'iPhone' via search fallback");
    const iphoneDetails = await productTools['product.getDetails'].handler({ product_id: 'iPhone' }, mockContext);

    if (iphoneDetails.product) {
        console.log(`SUCCESS: Resolved 'iPhone' to ID: ${iphoneDetails.product.id} (Title: ${iphoneDetails.product.name})`);
    } else {
        console.warn("FAILURE: Could not resolve 'iPhone'. Check if database is populated.");
    }

    // Scenario 2: Resolve conversational reference
    // First, we mock a search result in the state
    console.log("\nScenario 2: Resolve 'the first one' via state reference");
    const mockProducts = [{ id: 'mock-id-123', name: 'Mock Laptop' }];
    await stateManager.updateReferenceMap(mockContext.sessionId, mockProducts);

    const firstOneDetails = await productTools['product.getDetails'].handler({ product_id: 'the first one' }, mockContext);

    // This will likely fail the backend call as 'mock-id-123' doesn't exist, 
    // but we can check the RESOLUTION logic outcome by looking at the error message.
    if (firstOneDetails.error && firstOneDetails.error.includes('mock-id-123')) {
        console.log("SUCCESS: Correctly resolved 'the first one' to 'mock-id-123'.");
    } else {
        console.warn("FAILURE: Could not resolve 'the first one' or unexpected error:", firstOneDetails.error);
    }

    console.log("\n=== TEST COMPLETE ===");
}

runTest().catch(err => console.error(err));
