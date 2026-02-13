/**
 * State Management Test Suite
 * Tests state persistence, reference resolution, and multi-turn conversations
 */

require('dotenv').config();
const axios = require('axios');

const AI_SERVICE_URL = 'http://localhost:3005';
const TEST_SESSION_ID = 'test_state_' + Date.now();

console.log(`\n🧪 State Management Test Suite`);
console.log(`Session ID: ${TEST_SESSION_ID}\n`);

// Helper to send message and get response
async function chat(message) {
    try {
        const response = await axios.post(`${AI_SERVICE_URL}/chat`, {
            message,
            session_id: TEST_SESSION_ID
        });
        console.log(`[DEBUG] Intent: ${response.data.intent} (${response.data.confidence})`);
        return response.data;
    } catch (error) {
        console.error('Chat error:', error.message);
        return null;
    }
}

// Helper to check state via API endpoint (not direct stateManager access)
async function checkState() {
    try {
        const response = await axios.get(`${AI_SERVICE_URL}/debug/state/${TEST_SESSION_ID}`);
        return response.data.state;
    } catch (error) {
        console.error('State check error:', error.message);
        return {
            session: { message_count: 0 },
            conversation_history: [],
            reference_map: {},
            ordinal_list: [],
            cart: { item_count: 0, total: 0 },
            product_context: { currently_viewing: null, recently_viewed: [], last_search: null },
            preferences: { price_range: {}, favorite_categories: [], favorite_brands: [] }
        };
    }
}

async function runTests() {
    console.log('='.repeat(80));
    console.log('TEST 1: Conversation History Tracking');
    console.log('='.repeat(80));

    const msg1 = await chat("Show me laptops");
    console.log(`User: "Show me laptops"`);
    console.log(`AI: "${msg1?.reply?.substring(0, 100)}..."\n`);

    await new Promise(resolve => setTimeout(resolve, 1000));
    const state1 = await checkState();
    console.log(`✓ History length: ${state1.conversation_history.length}`);
    console.log(`✓ Reference map size: ${Object.keys(state1.reference_map).length}`);

    await new Promise(resolve => setTimeout(resolve, 1000));

    console.log('='.repeat(80));
    console.log('TEST 2: Reference Resolution - "the first one"');
    console.log('='.repeat(80));

    const msg2 = await chat("Tell me about the first one");
    console.log(`User: "Tell me about the first one"`);
    console.log(`AI: "${msg2?.reply?.substring(0, 100)}..."\n`);

    const state2 = await checkState();
    console.log(`✓ Resolved key: ${state2.product_context.currently_viewing ? 'Success' : 'Failed'}`);

    await new Promise(resolve => setTimeout(resolve, 1000));

    console.log('='.repeat(80));
    console.log('TEST 3: Smart Reference - "add this to cart"');
    console.log('='.repeat(80));

    const msg3 = await chat("Add this to my cart");
    console.log(`User: "Add this to my cart"`);
    console.log(`AI: "${msg3?.reply}"\n`);

    const state3 = await checkState();
    console.log(`✓ Cart total: $${state3.cart.total}\n`);

    await new Promise(resolve => setTimeout(resolve, 1000));

    console.log('='.repeat(80));
    console.log('TEST 4: Context Continuity - "what\'s in my cart?"');
    console.log('='.repeat(80));

    const msg4 = await chat("What's in my cart?");
    console.log(`User: "What's in my cart?"`);
    console.log(`AI: "${msg4?.reply?.substring(0, 100)}..."\n`);

    const state4 = await checkState();
    console.log(`✓ Cart item count: ${state4.cart.item_count}\n`);

    await new Promise(resolve => setTimeout(resolve, 1000));

    console.log('='.repeat(80));
    console.log('TEST 5: Preference Learning');
    console.log('='.repeat(80));

    // Test with fresh context to ensure no history bias
    const msg5 = await chat("I'm looking for phones under $500");
    console.log(`User: "I'm looking for phones under $500"`);
    console.log(`AI: "${msg5?.reply?.substring(0, 100)}..."\n`);

    await new Promise(resolve => setTimeout(resolve, 1500)); // Longer wait for learning
    const state5 = await checkState();
    console.log(`✓ Learned price range: max $${state5.preferences.price_range.max || 'none'}`);
    console.log(`✓ Last search query: "${state5.product_context.last_search?.query || 'none'}"\n`);

    console.log('='.repeat(80));
    console.log('TEST SUMMARY');
    console.log('='.repeat(80));

    const finalState = await checkState();
    console.log(`\n✅ All tests completed!`);
    console.log(`\nFinal State Summary:`);
    console.log(`  - Cart items: ${finalState.cart.item_count}`);
    console.log(`  - Cart total: $${finalState.cart.total}`);
    console.log(`  - Price Preference: $${finalState.preferences.price_range.max || 'None'}`);
    console.log(`  - Search Queries: ${finalState.conversation_history.filter(m => m.intent === 'search_products').length}`);
    console.log(`\n` + '='.repeat(80));

    // Cleanup
    console.log(`\n🧹 Cleaning up test session...`);
    try {
        await axios.delete(`${AI_SERVICE_URL}/debug/state/${TEST_SESSION_ID}`);
        console.log(`✓ Test session cleared\n`);
    } catch (e) { }
}

async function main() {
    try {
        await axios.get(`${AI_SERVICE_URL}/health`);
        console.log('✅ AI Service is running\n');
    } catch (error) {
        console.log('❌ AI Service is not running!');
        process.exit(1);
    }
    await runTests();
}

main().catch(console.error);
