const axios = require('axios');
require('dotenv').config();

const API_URL = 'http://localhost:3005';
const SESSION_ID = 'personality_test_' + Date.now();

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
    console.log('🚀 Starting Personality & Starter Test');

    // 1. Basic Greeting
    console.log('\n--- Step 1: Greeting ---');
    const res1 = await chat("hii");
    console.log(`AI (intent: ${res1.intent}): "${res1.reply}"`);

    // 2. Capability Question
    console.log('\n--- Step 2: Capability ---');
    const res2 = await chat("What can you do for me?");
    console.log(`AI (intent: ${res2.intent}): "${res2.reply}"`);

    // 3. Branded Greeting
    console.log('\n--- Step 3: Branded Greeting ---');
    const res3 = await chat("Good morning!");
    console.log(`AI (intent: ${res3.intent}): "${res3.reply}"`);

    // 4. Can-based question
    console.log('\n--- Step 4: Can-based Question ---');
    const res4 = await chat("Can you find me a cheap laptop?");
    console.log(`AI (intent: ${res4.intent}): "${res4.reply}"`);

    const isFriendly = res1.reply.toLowerCase().includes('welcome') || res1.reply.toLowerCase().includes('hello') || res1.reply.toLowerCase().includes('hi');
    const isBranded = res1.reply.includes('Be3') || res3.reply.includes('Be3');

    if (isFriendly && isBranded) {
        console.log('\n✅ Success: Bot feels friendly and branded.');
    } else {
        console.warn('\n❌ Warning: Personality might still be dry.');
        console.log('Friendly:', isFriendly, '| Branded:', isBranded);
    }
}

runTest();
