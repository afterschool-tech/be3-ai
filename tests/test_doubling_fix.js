const { resolveAndMap } = require('../src/services/intentResolver');

async function testDoublingAndPorting() {
    const logs = [];
    const log = (msg) => { console.log(msg); logs.push(msg); };

    log('🧪 Starting Doubling Fix & Porting Verification...');

    const mockAi = async () => "{}";
    const mockContext = {
        CATEGORIES: {
            'laptops': { id: 'cat-1', label: 'Laptops', slug: 'laptops' }
        }
    };

    // State with macbook_air resolved in reference_map
    // AND it's currently viewing macbook_air
    const state = {
        session_id: "test-session",
        product_context: {
            currently_viewing: "4cafd32f-9aa9-4889-b281-bf8c9af951c1",
            last_search: {
                results: [
                    { id: "4cafd32f-9aa9-4889-b281-bf8c9af951c1", name: "Macbook air" }
                ]
            }
        },
        reference_map: {
            "macbook_air": "4cafd32f-9aa9-4889-b281-bf8c9af951c1",
            "macbook": "4cafd32f-9aa9-4889-b281-bf8c9af951c1" // This was causing the doubling
        }
    };

    const cases = [
        {
            name: "Doubling Prevention Check",
            input: "I want to buy MacBook air",
            expectedText: "i want to buy macbook air", // Should resolve only once
            expectedIntent: "add_to_cart"
        }
    ];

    for (const test of cases) {
        log(`\nTesting: "${test.name}"`);
        const result = await resolveAndMap(test.input, state, mockAi, mockContext);

        // Log the internal pipeline transformations (extracted via debug logs if we could, but let's check final intent & params)
        const winner = result.intents[0];
        const productParam = winner.parameters.product_name;

        log(`   Input: "${test.input}"`);
        log(`   Resolved Product Param: "${productParam}"`);
        log(`   Winning Intent: ${winner.intentName}`);

        const doublingFound = productParam.toLowerCase().includes("air air");
        if (doublingFound) {
            log(`❌ FAIL: Doubling detected ("${productParam}")`);
        } else if (winner.intentName !== test.expectedIntent) {
            log(`❌ FAIL: Expected intent ${test.expectedIntent}, got ${winner.intentName}`);
        } else {
            log(`✅ PASS: No doubling and correct porting!`);
        }
    }

    require('fs').writeFileSync('tests/test_results_doubling.log', logs.join('\n'));
}

testDoublingAndPorting().catch(console.error);
