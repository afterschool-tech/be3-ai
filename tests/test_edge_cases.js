/**
 * Edge Case Test Suite
 * Tests potential failure points, context switching, and ambiguous references
 */

require('dotenv').config();
const axios = require('axios');

const AI_SERVICE_URL = 'http://localhost:3005';
const TEST_SESSION_ID = 'test_edge_' + Date.now();

console.log(`\n🧪 Edge Case Test Suite`);
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

// Helper to check state
async function checkState() {
    try {
        const response = await axios.get(`${AI_SERVICE_URL}/debug/state/${TEST_SESSION_ID}`);
        return response.data.state;
    } catch (error) {
        return null;
    }
}

async function runTests() {
    console.log('='.repeat(80));
    console.log('TEST 1: Context Switching (Laptops -> Phones)');
    console.log('='.repeat(80));

    await chat("Show me laptops");
    console.log('User: "Show me laptops"');

    await chat("Now show me phones under $500");
    console.log('User: "Now show me phones under $500"');

    const msg1 = await chat("Tell me more about the first one");
    console.log('User: "Tell me more about the first one"');
    console.log(`AI: "${msg1?.reply?.substring(0, 100)}..."`);

    const state1 = await checkState();
    const product = state1.conversation_history.find(m => m.role === 'ai' && m.text.includes('Tecno')) ||
        state1.conversation_history.find(m => m.role === 'ai' && m.text.includes('Infinix'));

    console.log(`✓ Should be a phone: ${msg1?.reply?.toLowerCase().includes('phone') || msg1?.reply?.toLowerCase().includes('tecno') ? 'YES' : 'NO'}`);

    console.log('\n' + '='.repeat(80));
    console.log('TEST 2: Brand Reference Ambiguity');
    console.log('='.repeat(80));
    // If we have multiple Tecno phones, "the tecno" should resolve to something sensible
    const msg2 = await chat("Add the Tecno to my cart");
    console.log('User: "Add the Tecno to my cart"');
    console.log(`AI: "${msg2?.reply}"`);

    const state2 = await checkState();
    console.log(`✓ Cart item count: ${state2.cart.item_count}`);

    console.log('\n' + '='.repeat(80));
    console.log('TEST 3: Non-existent Reference Fallback');
    console.log('='.repeat(80));
    const msg3 = await chat("Show me details for the Invisible Supercar");
    console.log('User: "Show me details for the Invisible Supercar"');
    console.log(`AI: "${msg3?.reply}"`);
    console.log(`✓ Handled gracefully: ${msg3?.reply?.includes('could not find') || msg3?.reply?.includes('specify') ? 'YES' : 'NO'}`);

    console.log('\n' + '='.repeat(80));
    console.log('TEST 4: Mid-Conversation State Loss (Simulated)');
    console.log('='.repeat(80));
    console.log('Clearing state via debug endpoint...');
    await axios.delete(`${AI_SERVICE_URL}/debug/state/${TEST_SESSION_ID}`);

    const msg4 = await chat("What was the first thing we talked about?");
    console.log('User: "What was the first thing we talked about?"');
    console.log(`AI: "${msg4?.reply}"`);

    console.log('\n' + '='.repeat(80));
    console.log('TEST 5: Aggressive Price Range Extraction');
    console.log('='.repeat(80));
    const msg5 = await chat("Show me something between 10 and 30 dollars");
    console.log('User: "Show me something between 10 and 30 dollars"');

    const state5 = await checkState();
    // In our handleSearchProducts, the fallback regex might not handle "between X and Y" yet
    // Let's see if the AI intent classification picks it up correctly
    console.log(`✓ Last search query: "${state5.product_context.last_search?.query}"`);
    console.log(`✓ Max price preference: ${state5.preferences.price_range.max}`);

    console.log('\n' + '='.repeat(80));
    console.log('TEST SUMMARY');
    console.log('='.repeat(80));
    console.log('Cleaning up...');
    await axios.delete(`${AI_SERVICE_URL}/debug/state/${TEST_SESSION_ID}`);
    console.log('Done.');
}

async function main() {
    try {
        await axios.get(`${AI_SERVICE_URL}/health`);
        await runTests();
    } catch (e) {
        console.error('Service should be running on :3005');
    }
}

main();
