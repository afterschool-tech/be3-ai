/**
 * Phase 5 Verification: Retry & Discovery
 * Tests that "Try again" works correctly and discovery tools provide data-backed info.
 */

const { selectTools } = require('../src/core/toolSelector');

async function testScenario(label, message, history = []) {
    console.log(`\n--- [SCENARIO: ${label}] ---`);
    console.log(`User: "${message}"`);
    const selection = await selectTools(message, history);
    console.log(`Result:`, JSON.stringify(selection, null, 2));
}

async function runTests() {
    console.log("=== STARTING RETRY & DISCOVERY VERIFICATION ===");

    // Scenario 1: Retry Logic (Should NOT pick Samsung)
    await testScenario(
        "Retry Context Retrieval",
        "Try again",
        [
            { role: 'user', text: "Laptops under $600" },
            { role: 'ai', text: "I'm having a bit of trouble connecting right now." } // Simulating the failure
        ]
    );

    // Scenario 2: Exploratory Query (Should pick discovery tools)
    await testScenario(
        "Exploratory Browse",
        "What do you suggest for me today?"
    );

    // Scenario 3: Trending request
    await testScenario(
        "Trending Items",
        "What's popular right now?"
    );

    console.log("\n=== VERIFICATION COMPLETE ===");
}

runTests().then(() => process.exit(0));
