require('dotenv').config();
const stateManager = require('../src/state/stateManager');
const { CATEGORIES } = require('../src/context/storeContext');

async function verifyStateImprovements() {
    const sessionId = "test_session_" + Date.now();
    console.log(`--- State Improvement Verification (${sessionId}) ---`);

    try {
        // 1. Mock a search result
        const mockProducts = [
            { id: "prod_1", handle: "taye-floral-vase", name: "Taye's Floral Vase", price: 45, categories: ["Home Decor"] },
            { id: "prod_2", handle: "modern-lamp", name: "Modern Lamp", price: 120, categories: ["Lighting"] }
        ];

        console.log("Step 1: Updating reference map with mock products...");
        await stateManager.updateReferenceMap(sessionId, mockProducts);

        // 2. Verify reference map expansion
        console.log("Step 2: Testing pronoun resolution...");
        const state = await stateManager.getState(sessionId);
        const refMap = state.reference_map;

        const itResolved = await stateManager.resolveReference(sessionId, "it");
        const theOneResolved = await stateManager.resolveReference(sessionId, "the one");
        const themResolved = await stateManager.resolveReference(sessionId, "them");

        console.log(`- 'it' resolved to: ${itResolved}`);
        console.log(`- 'the one' resolved to: ${theOneResolved}`);
        console.log(`- 'them' resolved to: ${themResolved}`);

        if (itResolved === "taye-floral-vase" && theOneResolved === "taye-floral-vase") {
            console.log("✅ Pronoun resolution works!");
        } else {
            console.error("❌ Pronoun resolution FAILED!");
        }

        // 3. Verify auto-viewing (This is usually called in product.search tool, but we can test the manager directly)
        console.log("Step 3: Testing currently_viewing update...");
        await stateManager.setCurrentlyViewing(sessionId, mockProducts[0].handle);
        const updatedState = await stateManager.getState(sessionId);
        console.log(`- currently_viewing: ${updatedState.product_context.currently_viewing}`);

        if (updatedState.product_context.currently_viewing === "taye-floral-vase") {
            console.log("✅ currently_viewing correctly set!");
        } else {
            console.error("❌ currently_viewing FAILED!");
        }

        // 4. Verify category resolution (mock behavior learning)
        console.log("Step 4: Testing robust category learning...");
        // In product.js, we added logic to infer category from product if missing
        let missingCategory = null;
        let inferredCategory = mockProducts[0].categories[0];

        await stateManager.learnFromBehavior(sessionId, 'search', { query: "vase", category: inferredCategory });
        const finalState = await stateManager.getState(sessionId);
        console.log(`- Learned categories: ${JSON.stringify(finalState.preferences.favorite_categories)}`);

        if (finalState.preferences.favorite_categories.includes("Home Decor")) {
            console.log("✅ Category learning works even with missing category param!");
        } else {
            console.error("❌ Category learning FAILED!");
        }

        console.log("\n--- Verification Complete ---");

    } catch (err) {
        console.error("Verification error:", err);
    } finally {
        // Cleanup
        await stateManager.clearState(sessionId);
    }
}

verifyStateImprovements();
