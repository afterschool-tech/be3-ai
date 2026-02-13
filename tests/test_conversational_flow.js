const axios = require('axios');

const API_URL = 'http://localhost:3005/chat';
const SESSION_ID = 'test_session_' + Date.now();

async function sendMessage(text) {
    try {
        const response = await axios.post(API_URL, {
            message: text,
            sessionId: SESSION_ID
        });
        return response.data;
    } catch (error) {
        console.error('Error sending message:', error.message);
        return null;
    }
}

async function runTests() {
    console.log('🤖 STARTING CONVERSATIONAL FLOW TESTS\n');
    console.log(`Session ID: ${SESSION_ID}\n`);

    // TEST 1: Conversational Priority
    console.log('--- TEST 1: Conversational Priority ---');
    console.log('User: "Hey there, how are you?"');
    const res1 = await sendMessage("Hey there, how are you?");
    console.log(`Bot: ${res1.message}`);

    if (res1.products && res1.products.length === 0) {
        console.log('✅ PASS: No products returned for greeting');
    } else {
        console.log('❌ FAIL: Products returned for greeting');
    }
    console.log('\n');

    // TEST 2: Search & Context Creation
    console.log('--- TEST 2: Search & Context Creation ---');
    console.log('User: "Show me laptops"');
    const res2 = await sendMessage("Show me laptops");
    console.log(`Bot: ${res2.message}`);
    const productsFound = res2.products?.length || 0;
    console.log(`[Context] Found ${productsFound} products`);
    console.log('\n');

    // TEST 3: Context Pause (Switching to Chat)
    console.log('--- TEST 3: Context Pause (Switching to Chat) ---');
    console.log('User: "Actually, how is the weather?" (or any chat)');
    const res3 = await sendMessage("Actually, that's cool. How are you doing?");
    console.log(`Bot: ${res3.message}`);

    if (!res3.products) {
        console.log('✅ PASS: Context paused, no products shown in chat');
    } else {
        console.log('❌ FAIL: Context NOT paused, products still shown');
    }
    console.log('\n');

    // TEST 4: Context Resume
    console.log('--- TEST 4: Context Resume ---');
    console.log('User: "Back to those laptops"');
    const res4 = await sendMessage("Back to those laptops");
    console.log(`Bot: ${res4.message}`);

    if (res4.products && res4.products.length === productsFound) {
        console.log('✅ PASS: Context resumed, same products returned');
    } else {
        console.log(`❌ FAIL: Context resumption failed. Got ${res4.products?.length || 0} products`);
    }
    console.log('\n');

    // TEST 5: Unknown Intent Recovery
    console.log('--- TEST 5: Unknown Intent Recovery ---');
    // First establish context
    await sendMessage("Show me gaming laptops");
    console.log('[Setup] User asked for gaming laptops');

    console.log('User: "What about the battery?" (Contextual follow-up)');
    const res5 = await sendMessage("What about the battery?");
    console.log(`Bot: ${res5.message}`);

    if (!res5.message.toLowerCase().includes("don't understand") &&
        !res5.message.toLowerCase().includes("not sure")) {
        console.log('✅ PASS: Bot recovered intent using context');
    } else {
        console.log('❌ FAIL: Bot defaulted to unknown intent');
    }
    console.log('\n');

    console.log('🎉 TESTS COMPLETED');
}

runTests();
