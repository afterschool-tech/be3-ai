const { resolveAndMap } = require('../src/services/intentResolver');

async function testImplicitRefinement() {
    console.log('🧪 Starting Implicit & Filler Refinement Tests...');

    const mockAi = async () => "{}";
    const mockState = { conversation_history: [] };
    const mockContext = { CATEGORIES: [] };

    const cases = [
        {
            name: "Polluted Search (yes i need...)",
            input: "yes i need iphone 12",
            expectedIntent: "product_search",
            expectedParam: { product_name: "iphone 12" }
        },
        {
            name: "Bare Product (implicit)",
            input: "iphone 15",
            expectedIntent: "product_search",
            expectedParam: { product_name: "iphone 15" }
        }
    ];

    for (const test of cases) {
        console.log(`\nTesting: "${test.name}"`);
        const result = await resolveAndMap(test.input, mockState, mockAi, mockContext);
        const winner = result.intents[0];

        const intentMatch = winner.intentName === test.expectedIntent;
        const paramMatch = JSON.stringify(winner.parameters) === JSON.stringify(test.expectedParam);

        if (intentMatch && paramMatch) {
            console.log(`✅ PASS`);
        } else {
            console.log(`❌ FAIL`);
            console.log(`   Got Intent: ${winner.intentName}`);
            console.log(`   Got Params:`, winner.parameters);
        }
    }
}

testImplicitRefinement().catch(console.error);
