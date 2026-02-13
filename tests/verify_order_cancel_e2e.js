/**
 * Full E2E Test: Order Cancellation
 * 1. Creates a real order in the DB
 * 2. Cancels it using the AI tool
 * 3. Verifies the status in the DB
 */

const { executeTools } = require('../src/core/orchestrator');
const { query } = require('../../config/database');

const TENANT_ID = 'cbe1df05-45ed-455a-9ce6-156b0bd45713';
const ORDER_NUMBER = 'TEST-CANCEL-' + Date.now();

async function runTest() {
    console.log("=== STARTING FULL E2E ORDER CANCEL VERIFICATION ===");

    try {
        // 1. Create a test order
        console.log(`Creating test order ${ORDER_NUMBER}...`);
        const insertRes = await query(
            `INSERT INTO orders (tenant_id, order_number, status, subtotal, total, currency, customer_email) 
             VALUES ($1, $2, 'pending', 100.00, 100.00, 'USD', 'test@example.com') 
             RETURNING id`,
            [TENANT_ID, ORDER_NUMBER]
        );
        const orderId = insertRes.rows[0].id;
        console.log(`Created order with ID: ${orderId}`);

        // 2. Cancel via tool
        const sessionId = "test-e2e-cancel-" + Date.now();
        const testTools = [
            {
                tool: "order.cancel",
                params: { order_number: ORDER_NUMBER },
                reason: "User wants to cancel their order"
            }
        ];

        console.log("Executing order.cancel tool...");
        const results = await executeTools(testTools, sessionId);
        const res = results[0];

        if (res.success) {
            console.log("✅ Tool Success:", res.result.message);

            // 3. Verify in DB
            const verifyRes = await query(
                `SELECT status FROM orders WHERE id = $1 AND tenant_id = $2`,
                [orderId, TENANT_ID]
            );

            if (verifyRes.rows[0].status === 'cancelled') {
                console.log("✅ DB Verified: Status is 'cancelled'");
            } else {
                console.error("❌ DB Verification Failed: Status is", verifyRes.rows[0].status);
            }
        } else {
            console.error("❌ Tool Failed:", res.result ? res.result.error : res.error);
        }

        // Cleanup
        // await query(`DELETE FROM orders WHERE id = $1`, [orderId]);
        // console.log("Cleanup complete.");

    } catch (e) {
        console.error("❌ Test crashed:", e.message);
    }

    console.log("=== E2E VERIFICATION COMPLETE ===");
}

runTest().then(() => process.exit(0));
