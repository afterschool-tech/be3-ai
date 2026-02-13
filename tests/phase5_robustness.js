/**
 * Phase 5 Robustness Verification
 * Tests the new tool selection prompt and normalization logic.
 */

const { selectTools } = require('../src/core/toolSelector');

async function testScenario(label, message, history = []) {
    console.log(`\n--- [SCENARIO: ${label}] ---`);
    console.log(`User: "${message}"`);
    const selection = await selectTools(message, history);
    console.log(`Result:`, JSON.stringify(selection, null, 2));

    if (selection.length > 2) {
        console.warn(`⚠️ Warning: Selected ${selection.length} tools. Goal is < 3.`);
    }
}

async function runTests() {
    console.log("=== STARTING PHASE 5 ROBUSTNESS TESTS ===");

    // Scenario 1: Smartphone search (previously picked 6 tools)
    await testScenario(
        "Smartphone Discovery",
        "What kind of smartphones do you have in stock?"
    );

    // Scenario 2: Brand specific (previously picked 0 tools)
    await testScenario(
        "Brand Search",
        "show me all your samsung devices"
    );

    // Scenario 3: Specific category breadcrumb (normalization test)
    await testScenario(
        "Breadcrumb Category",
        "Tell me about the one under VR & AR Headset"
    );

    // Scenario 4: Headset query (contextual search)
    await testScenario(
        "Headset Query",
        "Do you have an headset"
    );

    console.log("\n=== TESTS COMPLETE ===");
}

runTests().then(() => process.exit(0));
