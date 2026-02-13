const axios = require('axios');
require('dotenv').config();

const API_URL = 'http://localhost:3005';
const SESSION_ID = 'advice_test_session_' + Date.now();

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
    console.log('🚀 Starting Conversational Advice Test');

    // 1. Establish context (view a product)
    console.log('\n--- Step 1: Establish Context ---');
    const res1 = await chat("Show me iPhone 15");
    console.log(`AI (intent: ${res1.intent}): "${res1.reply.substring(0, 50)}..."`);

    // 2. Ask follow-up advice
    console.log('\n--- Step 2: Ask Advice ---');
    const res2 = await chat("is this a good phone for a college student?");
    console.log(`AI (intent: ${res2.intent}): "${res2.reply}"`);

    if (res2.intent === 'get_advice') {
        console.log('\n✅ Success: Intent correctly classified as "get_advice"');
    } else {
        console.warn('\n❌ Warning: Intent classified as', res2.intent);
    }

    // 3. Ask another follow-up
    console.log('\n--- Step 3: Specific reasoning ---');
    const res3 = await chat("why do you think it's worth the price?");
    console.log(`AI (intent: ${res3.intent}): "${res3.reply}"`);
}

runTest();
