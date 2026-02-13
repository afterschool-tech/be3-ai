/**
 * Targeted Test: Order Cancellation
 * Verifies that order.cancel tool correctly hits the backend.
 */

const { executeTools } = require('../src/core/orchestrator');

async function runTest() {
    console.log("=== STARTING ORDER CANCEL VERIFICATION ===");
    const sessionId = "test-order-cancel-" + Date.now();

    // 1. First, we need an order to cancel. 
    // In this simulation, we'll try to cancel order #12345 
    // The backend should return 404 if not found, but NOT 404 Route Not Found.

    const testTools = [
        {
            tool: "order.cancel",
            params: { order_number: "ORD-TEST-999" },
            reason: "Cancelling test order"
        }
    ];

    try {
        const results = await executeTools(testTools, sessionId);
        const res = results[0];

        if (res.success) {
            console.log("✅ Tool Success:", res.result.message);
        } else {
            // If it's a "Order not found" error, it means the ROUTE works (it hit the code).
            if (res.error && res.error.includes("Order not found")) {
                console.log("✅ Route Verified (Order correctly not found, but route exists)");
            } else {
                console.error("❌ Tool Failed:", res.error);
            }
        }
    } catch (e) {
        console.error("❌ Test crashed:", e.message);
    }

    console.log("=== VERIFICATION COMPLETE ===");
}

runTest();
