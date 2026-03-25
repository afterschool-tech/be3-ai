const { resolveDeterministic } = require('../src/core/deterministicResolver');
const stateManager = require('../src/state/stateManager');

async function test(text) {
    const state = await stateManager.getState('test_session');
    const result = await resolveDeterministic(text, state);
    const intent = result.result?.intents?.[0]?.intentName || 'unknown';
    const score = result.result?.intents?.[0]?.score || 0;
    console.log(`Input: "${text}" -> Intent: ${intent} (Score: ${score.toFixed(2)})`);
}

async function run() {
    console.log('--- Testing New Variations (African Style Simple English) ---');
    await test("Please help me explain what this camera is all about.");
    await test("I want to see all the technical details for this laptop.");
    await test("What are the different colors available for this shirt?");
    await test("Tell me about the power of this blender, how fast is the chip?");

    console.log('\n--- Testing Relocated Variations (to get_help) ---');
    await test("Is this compatible with my phone?");
    await test("How to install this thing?");
    await test("Give me some tips for using this.");
}

run().catch(console.error);
