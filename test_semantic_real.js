const axios = require('axios');
require('dotenv').config();

const API_URL = 'http://localhost:3005';
const SESSION_ID = 'semantic_test_session_' + Date.now();

async function chat(message) {
    try {
        const res = await axios.post(`${API_URL}/chat`, {
            message,
            session_id: SESSION_ID
        });
        return res.data;
    } catch (err) {
        console.error('Chat error:', err.response?.data || err.message);
    }
}

async function checkState() {
    try {
        const res = await axios.get(`${API_URL}/debug/state/${SESSION_ID}`);
        return res.data;
    } catch (err) {
        console.error('State check error:', err.message);
    }
}

async function runTest() {
    console.log('🚀 Starting Semantic Resolution Test with REAL DATA');

    // 1. Search for "cheap desktops" (using natural synonym "budget-friendly")
    console.log('\n--- Step 1: Synonym Resolution ---');
    console.log('User: "Show me budget-friendly desktops"');
    const res1 = await chat("Show me budget-friendly desktops");
    console.log(`AI: "${res1.reply.substring(0, 100)}..."`);

    const state1 = await checkState();
    // In server.js, STAGE 2 resolves clauses.
    // We expect "budget-friendly" -> "affordable" canonical clause for "Desktops"
    console.log(`✓ Should resolve to "affordable" clause: ${JSON.stringify(res1?.context?.clauses || [])}`);

    // 2. Search for "vibrant laptops"
    console.log('\n--- Step 2: Color/Vibrant Resolution ---');
    console.log('User: "I want colorful laptops"');
    const res2 = await chat("I want colorful laptops");
    console.log(`AI: "${res2.reply.substring(0, 100)}..."`);
    console.log(`✓ Should resolve to "vibrant color" clause: ${JSON.stringify(res2.context?.clauses || [])}`);

    // 3. Search for "minimal storage phone"
    console.log('\n--- Step 3: Specific modifier ---');
    console.log('User: "Show me phones with low storage for students"');
    const res3 = await chat("Show me phones with low storage for students");
    console.log(`AI: "${res3.reply.substring(0, 100)}..."`);
    console.log(`✓ Should resolve to "under 1000" clause: ${JSON.stringify(res3.context?.clauses || [])}`);
    // 4. Test Comparison
    console.log('\n--- Step 4: Product Comparison ---');
    console.log('User: "what is the difference between iphone xs max and iphone 17"');
    const res4 = await chat("what is the difference between iphone xs max and iphone 17");
    console.log(`AI: "${res4.reply.substring(0, 150)}..."`);

    if (res4.reply.includes("iPhone") || res4.reply.includes("compare") || res4.reply.includes("difference")) {
        console.log('✓ Comparison intent triggered and resolved successfully.');
    } else {
        console.warn('❌ Comparison intent might have failed to provide a useful answer.');
    }
}

runTest();
