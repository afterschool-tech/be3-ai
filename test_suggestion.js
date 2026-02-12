/**
 * Test Bot Suggestion Tracking
 * 
 * Replicates scenarios where the bot makes a suggestion and the user confirms it:
 * 1. Bot Greeting -> "Would you like me to show you the Flight Stick?" -> User: "yes"
 * 2. Bot Advice -> "I can help you compare models" -> User: "okay compare"
 */

const axios = require('axios');

async function testSuggestionTracking() {
    const session_id = `test_suggestion_${Date.now()}@test`;
    const BASE_URL = 'http://localhost:3005';

    console.log('🧪 Testing Bot Suggestion Tracking\n');

    // SCENARIO 1: Greeting Suggestion
    console.log('--- SCENARIO 1: Greeting Suggestion ---');

    // 1. Greeting
    console.log('1. Sending Greeting...');
    let greetingRep = await axios.post(`${BASE_URL}/chat`, {
        message: "hi",
        session_id: session_id
    });
    console.log(`Bot: "${greetingRep.data.reply.substring(0, 100)}..."`);

    // 2. User confirms (expect search or advice based on suggestion)
    console.log('\n2. Sending Confirmation ("yes")...');
    let confirmRep = await axios.post(`${BASE_URL}/chat`, {
        message: "yes",
        session_id: session_id
    });
    console.log(`Bot: "${confirmRep.data.reply.substring(0, 100)}..."`);
    console.log(`Intent: ${confirmRep.data.intent} (Confidence: ${confirmRep.data.confidence})`);

    if (confirmRep.data.intent !== 'fallback_unknown') {
        console.log('✅ SUCCESS: Bot resolved "yes" to a specific intent!');
    } else {
        console.log('❌ FAILURE: Bot did not resolve "yes" (fallback_unknown)');
    }

    // SCENARIO 2: Explicit "Compare" Offer
    console.log('\n--- SCENARIO 2: Compare Offer ---');

    // 1. Trigger advice that leads to offer (simulated by just setting state directly for test speed? 
    // No, let's try to trigger it naturally or just trust the greeting test)

    console.log('1. User asks for help...');
    let helpRep = await axios.post(`${BASE_URL}/chat`, {
        message: "i need a new phone",
        session_id: session_id
    });
    console.log(`Bot: "${helpRep.data.reply.substring(0, 100)}..."`);

    // 2. User says "compare"
    console.log('\n2. User says "compare"...');
    let compareRep = await axios.post(`${BASE_URL}/chat`, {
        message: "compare",
        session_id: session_id
    });
    console.log(`Bot: "${compareRep.data.reply.substring(0, 100)}..."`);
    console.log(`Intent: ${compareRep.data.intent}`);
}

testSuggestionTracking();
