require('dotenv').config();
const { resolveAndMap } = require('../src/services/intentResolver');
const stateManager = require('../src/state/stateManager');
const { CATEGORIES, VENDORS, ATTRIBUTES, COLLECTIONS } = require('../src/context/storeContext');

async function runTest() {
    const sessionId = "test_session_123";
    
    // Clear any previous state
    await stateManager.clearState(sessionId);
    
    // Inject a suggestion
    const mockSuggestion = {
        type: 'conversational_simulation',
        intent: 'add_to_cart',
        params: { product_id: '987654321', quantity: 1 },
        tool: 'cart.add',
        text: 'Would you like to add it to your cart?'
    };
    
    await stateManager.updateState(sessionId, {
        last_bot_suggestion: mockSuggestion
    });
    
    const stateBefore = await stateManager.getState(sessionId);
    console.log("State before processing 'Yes':", !!stateBefore.last_bot_suggestion);
    
    console.log("\n--- Sending 'Yes' ---");
    const result = await resolveAndMap('Yes', stateBefore, null, { CATEGORIES, VENDORS, ATTRIBUTES, COLLECTIONS });
    
    const stateAfter = await stateManager.getState(sessionId);
    
    require('fs').writeFileSync('debug.json', JSON.stringify(stateAfter, null, 2));

    require('fs').writeFileSync('test_out.json', JSON.stringify({
        stateBeforeSuggestion: !!stateBefore.last_bot_suggestion,
        resultIntents: result.intents,
        resultTools: result.tools,
        stateAfterSuggestion: !!stateAfter.last_bot_suggestion
    }, null, 2));
    
    process.exit(0);
}

runTest().catch(console.error);
