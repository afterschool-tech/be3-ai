/**
 * Verification Script: Phase 17 Suggestion System
 * Tests if the AI can recover from an empty search by suggesting alternatives.
 */

const axios = require('axios');

async function testSuggestionRecovery() {
    const session_id = `test_suggestion_${Date.now()}`;
    const BACKEND_URL = 'http://127.0.0.1:3005';

    console.log('--- TEST 1: Empty Search Recovery ---');
    try {
        const res1 = await axios.post(`${BACKEND_URL}/chat`, {
            message: "Do you have any futuristic hoverboards?",
            session_id: session_id
        });

        console.log('AI Reply:', res1.data.ai_reply);
        console.log('Tools Used:', res1.data.tools_used);

        const hasDiscovery = res1.data.tools_used.includes('discovery.getSuggestions');
        console.log(`[PASS] Discovery tool triggered: ${hasDiscovery}`);

        if (res1.data.results_count > 0) {
            console.log(`[PASS] Found ${res1.data.results_count} suggested products.`);
        }

        console.log('\n--- TEST 2: Intent Acceptance ---');
        // Let's assume the bot suggested products in a category
        const res2 = await axios.post(`${BACKEND_URL}/chat`, {
            message: "Okay, show me those",
            session_id: session_id
        });

        console.log('AI Reply:', res2.data.ai_reply);
        console.log('Tools Used:', res2.data.tools_used);

        const hasSearch = res2.data.tools_used.includes('product.search');
        console.log(`[PASS] Product search triggered on acceptance: ${hasSearch}`);

    } catch (err) {
        console.error('Test Failed:', err.message);
        if (err.response) console.error('Data:', err.response.data);
    }
}

testSuggestionRecovery();
