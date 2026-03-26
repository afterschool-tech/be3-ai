const { simulateMessage } = require('./__pipeline_tests__/harness.js');

async function run() {
    try {
        console.log("Starting test 1...");
        const res1 = await simulateMessage('add it to cart', {
            product_context: { last_search: { results: [{ id: 'uuid-123', name: 'MacBook Pro' }] } },
            reference_map: { 'it': 'uuid-123' }
        });
        console.log("Cart Mapping Result:", JSON.stringify(res1.intents[0]?.parameters, null, 2));

        console.log("Starting test 2...");
        const res2 = await simulateMessage('34, lagos ajah', {
            microstate: {
                name: 'collect_delivery_details',
                intent: 'set_delivery',
                contract: { maxMessages: 3, messagesUsed: 1, onFulfilled: ['address', 'delivery_type'] },
                params: {} 
            }
        });
        console.log("Delivery Mapping Result:", JSON.stringify(res2.intents[0]?.parameters, null, 2));

    } catch(e) {
        console.error("PIPELINE CRASH:", e);
    }
}
run();
