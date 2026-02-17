// Verification Script for Tool Selector
const { selectTools } = require('../src/core/toolSelector');

async function testToolSelection() {
    console.log("Testing Tool Selection with 'I want to checkout'...");

    const userMessage = "I want to checkout";
    const history = []; // Empty history for isolation

    try {
        const tools = await selectTools(userMessage, history);
        console.log("Selected Tools:", JSON.stringify(tools, null, 2));

        if (tools.some(t => t.tool === 'order.checkout')) {
            console.log("✅ SUCCESS: 'order.checkout' tool was selected.");
        } else {
            console.error("❌ FAILURE: 'order.checkout' tool was NOT selected.");
        }
    } catch (error) {
        console.error("❌ CRITICAL ERROR:", error);
    }
}

testToolSelection();
