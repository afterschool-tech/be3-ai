const { resolveAndMap } = require('../src/services/intentResolver');

async function testIntentPorter() {
    const logs = [];
    const log = (msg) => { console.log(msg); logs.push(msg); };

    log('🧪 Starting Intent Porter (Buy-vs-Search) Tests...');

    const mockAi = async () => "{}";
    const mockContext = {
        CATEGORIES: {
            'laptops': { id: 'cat-1', label: 'Laptops', slug: 'laptops' }
        }
    };

    // Mock state with a known product slug
    const stateWithMacbook = {
        conversation_history: [],
        reference_map: {
            'macbook_air': 'mac-uuid-123'
        }
    };

    const cases = [
        {
            name: "Strict Discovery (Known Product)",
            input: "show me macbook air",
            state: stateWithMacbook,
            expectedIntent: "product_search",
            note: "Should NOT port because 'show' is a discovery verb"
        },
        {
            name: "Purchase Pivot (Known Product)",
            input: "i want to buy macbook air",
            state: stateWithMacbook,
            expectedIntent: "add_to_cart",
            note: "Should PORT because 'buy' is a purchase verb and 'macbook_air' is known"
        },
        {
            name: "Purchase Default (Unknown Product)",
            input: "i want to buy iphone 15",
            state: stateWithMacbook,
            expectedIntent: "product_search",
            note: "Should NOT port because 'iphone 15' is unknown"
        },
        {
            name: "Filler Cleanup (to)",
            input: "i want to buy macbook air",
            state: stateWithMacbook,
            expectedParamHash: { product_name: "macbook air" },
            note: "Verify 'to' is stripped from product_name"
        }
    ];

    for (const test of cases) {
        log(`\nTesting: "${test.name}"`);
        const result = await resolveAndMap(test.input, test.state || { reference_map: {} }, mockAi, mockContext);
        const winner = result.intents[0];

        const intentMatch = !test.expectedIntent || (winner.intentName === test.expectedIntent);

        let paramMatch = true;
        if (test.expectedParamHash) {
            paramMatch = winner.parameters.product_name === test.expectedParamHash.product_name;
        }

        if (intentMatch && paramMatch) {
            log(`✅ PASS (${test.note || ''})`);
        } else {
            log(`❌ FAIL`);
            log(`   Expected Intent: ${test.expectedIntent}`);
            log(`   Got Intent: ${winner.intentName}`);
            log(`   Got Params: ${JSON.stringify(winner.parameters)}`);
        }
    }

    require('fs').writeFileSync('tests/test_results.log', logs.join('\n'));
}

testIntentPorter().catch(console.error);
