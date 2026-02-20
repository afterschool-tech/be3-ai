/**
 * Verify Integrated Parameter Extraction (Deterministic + Structural)
 */
const { extractParameters } = require('../src/services/intentResolver/pipeline/parameterExtractor');
const { CATEGORIES } = require('../src/context/storeContext');

const testCases = [
    {
        name: 'Simple search (Structural anchor)',
        text: 'find me some cheap iphone 12',
        candidates: [{ intentName: 'product_search', score: 1.0 }],
        expect: {
            product_name: 'iphone 12',
            clause_words: [{ word: 'cheap', clauseId: 'affordable' }]
        }
    },
    {
        name: 'Check availability (Filler stripping verify)',
        text: 'is the blue headset in stock?',
        candidates: [{ intentName: 'check_availability', score: 1.0 }],
        expect: {
            product_name: 'headset',
            clause_words: [{ word: 'blue', clauseId: 'color_for_ladies' }]
        }
    },
    {
        name: 'Comparison (Multi-product structural)',
        text: 'compare the macbook air with surface laptop',
        candidates: [{ intentName: 'product_compare', score: 1.0 }],
        expect: {
            products: ['macbook air', 'surface laptop']
        }
    },
    {
        name: 'Cart additions (Quantity positional)',
        text: 'add 5 milk to cart',
        candidates: [{ intentName: 'add_to_cart', score: 1.0 }],
        expect: {
            product_name: 'milk',
            quantity: 5
        }
    }
];

async function run() {
    console.log('=== INTEGRATED EXTRACTION VERIFICATION ===\n');

    let passed = 0;
    let failed = 0;

    for (const tc of testCases) {
        try {
            const result = await extractParameters(tc.text, tc.candidates, null, { CATEGORIES });

            let ok = true;
            if (tc.expect.product_name && result.product_name !== tc.expect.product_name) ok = false;
            if (tc.expect.quantity && result.quantity !== tc.expect.quantity) ok = false;
            if (tc.expect.products) {
                if (!result.products || result.products.length !== tc.expect.products.length) ok = false;
                else {
                    for (let i = 0; i < tc.expect.products.length; i++) {
                        if (result.products[i] !== tc.expect.products[i]) ok = false;
                    }
                }
            }
            if (tc.expect.clause_words) {
                if (!result.clause_words || result.clause_words.length !== tc.expect.clause_words.length) ok = false;
                else {
                    // Just check first clause word for simplicity in this test
                    if (result.clause_words[0].word !== tc.expect.clause_words[0].word) ok = false;
                }
            }

            if (ok) {
                console.log(`✅ ${tc.name}`);
                passed++;
            } else {
                console.log(`❌ ${tc.name}`);
                console.log(`   Input:    "${tc.text}"`);
                console.log(`   Template: "${result._structuralTemplate || 'NONE'}"`);
                console.log(`   Result:   ${JSON.stringify(result, null, 2)}`);
                console.log(`   Expected: ${JSON.stringify(tc.expect, null, 2)}`);
                failed++;
            }
        } catch (err) {
            console.error(`Error in test ${tc.name}:`, err);
            failed++;
        }
    }

    console.log(`\nResults: ${passed} passed, ${failed} failed out of ${testCases.length}`);
}

run();
