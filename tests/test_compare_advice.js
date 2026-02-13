const axios = require('axios');
require('dotenv').config();

const API_URL = 'http://localhost:3005';
const SESSION_ID = 'compare_advice_test_' + Date.now();

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
    console.log('🚀 Starting Comparison Context Test');

    // 1. Compare Tecno and iPhone
    console.log('\n--- Step 1: Comparison ---');
    const res1 = await chat("compare tecno tablet and iphone xs max");
    console.log(`AI (intent: ${res1.intent}): "${res1.reply.substring(0, 100)}..."`);

    // 2. Ask follow-up advice
    console.log('\n--- Step 2: Advice for compared items ---');
    const res2 = await chat("which one is better for a computer science student?");
    console.log(`AI (intent: ${res2.intent}): "${res2.reply}"`);

    const mentionedTecno = res2.reply.toLowerCase().includes('tecno') || res2.reply.toLowerCase().includes('mega pad');
    const mentionedIphone = res2.reply.toLowerCase().includes('iphone');

    if (mentionedTecno && mentionedIphone) {
        console.log('\n✅ Success: AI remembered BOTH products from the comparison.');
    } else {
        console.warn('\n❌ Warning: AI might have forgotten one or both products.');
        console.log('Mentioned Tecno:', mentionedTecno, '| Mentioned iPhone:', mentionedIphone);
    }
}

runTest();
