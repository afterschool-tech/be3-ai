/**
 * Trace Intent - Diagnostic script to trace the resolution pipeline
 */
const { resolveAndMap } = require('../src/services/intentResolver');
const storeContext = require('../src/context/storeContext');
const stateManager = require('../src/state/stateManager');

async function mockAiQuery(messages) {
    return JSON.stringify({}); // Pure deterministic trace
}

async function trace(query) {
    console.log(`\n=== TRACING: "${query}" ===`);
    const state = {};
    const result = await resolveAndMap(query, state, mockAiQuery, storeContext);

    console.log('\n--- Final Resolution ---');
    if (result.intents.length === 0) {
        console.log('No intent matched.');
    } else {
        result.intents.forEach((intent, i) => {
            console.log(`[${i}] Intent: ${intent.intentName}, Score: ${intent.score.toFixed(2)}`);
            console.log(`    Params: ${JSON.stringify(intent.parameters)}`);
            console.log(`    Keywords: [${intent.matchedKeywords.join(', ')}]`);
        });
    }

    console.log('\n--- Tools ---');
    result.tools.forEach(t => console.log(`Tool: ${t.tool}, Params: ${JSON.stringify(t.params)}`));
}

async function run() {
    await trace("i need Dareymi contact");
    await trace("i need Taye Home Decor products");
}

run().catch(console.error);
