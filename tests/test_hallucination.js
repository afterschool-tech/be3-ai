const axios = require('axios');
require('dotenv').config();

const API_URL = 'http://localhost:3005';
const SESSION_ID = 'hallucination_test_' + Date.now();

async function chat(message) {
    try {
        console.log(`\nUser: "${message}"`);
        const res = await axios.post(`${API_URL}/chat`, {
            message,
            session_id: SESSION_ID
        });
        return res.data;
    } catch (err) {
        console.error('Chat error:', err.response?.data || err.message);
    }
}

async function runTest() {
    console.log('🚀 Starting Hallucination & Context Transition Test');

    // 1. Ask about iPhone (Establish Context)
    console.log('\n--- Step 1: iPhone Advice ---');
    const res1 = await chat("is the iphone xs max good for a student?");
    console.log(`AI (intent: ${res1.intent}): "${res1.reply.substring(0, 100)}..."`);

    // 2. Bait the "Yes" transition 
    // We expect the AI to have offered laptops or other options in Step 1 or 2
    console.log('\n--- Step 2: Confirmation Transition ---');
    console.log('Context: AI likely asked "Would you like me to recommend some laptops?"');
    const res2 = await chat("yes please");
    console.log(`AI (intent: ${res2.intent}): "${res2.reply.substring(0, 150)}..."`);

    if (res2.intent === 'search_products') {
        console.log('\n✅ Success: Intent correctly transitioned to "search_products" for laptops.');
    } else {
        console.warn('\n❌ Warning: Intent remained as', res2.intent);
    }

    // 3. Verify No Hallucination
    const inventedList = ["Dell XPS", "HP Envy", "ThinkPad"];
    const containsHallucination = inventedList.some(item => res2.reply.includes(item));

    if (containsHallucination && res2.intent !== 'search_products') {
        console.error('\n🚨 FAULT: AI hallucinated laptops without searching!');
    } else if (res2.intent === 'search_products') {
        console.log('\n✅ Success: AI is performing a real search.');
    } else {
        console.log('\n✅ Success: No obvious hallucinations detected.');
    }
}

runTest();
