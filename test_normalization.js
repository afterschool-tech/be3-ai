
const { normalizeParameters } = require('./src/services/intentResolver/pipeline/parameterNormalizer');
const { CLAUSES } = require('./src/context/clauses');
const { CATEGORIES, ATTRIBUTES, VENDORS } = require('./src/context/storeContext');

const storeContext = { CATEGORIES, ATTRIBUTES, VENDORS };

const testCases = [
    {
        name: "Brand Folding (Top-level brand param)",
        intents: [{
            intentName: 'product_search',
            parameters: { brand: 'apple', query: 'apple products' }
        }],
        expectedAttr: { b: 'apple' }
    },
    {
        name: "Clause Mapping (apple_product + affordable)",
        intents: [{
            intentName: 'product_search',
            parameters: {
                clause_words: [
                    { clauseId: 'apple_product', word: 'apple' },
                    { clauseId: 'affordable', word: 'bucksaving' }
                ],
                query: 'bucksaving apple products'
            }
        }],
        expectedAttr: { 'b:a': 'apple', 'p:p': 'budget,midrange' }
    },
    {
        name: "Mixed Brand + Clause (Specific clause wins)",
        intents: [{
            intentName: 'product_search',
            parameters: {
                brand: 'apple',
                clause_words: [
                    { clauseId: 'apple_product', word: 'apple' }
                ]
            }
        }],
        expectedAttr: { 'b:a': 'apple' } // clause mapping wins over generic brand param
    }
];

testCases.forEach(tc => {
    console.log(`\n--- Test: ${tc.name} ---`);
    const results = normalizeParameters(tc.intents, storeContext);
    const actualParams = results[0].parameters;

    console.log('Actual Attributes:', JSON.stringify(actualParams.attributes, null, 2));
    console.log('Top-level brand:', actualParams.brand);

    // Simple validation
    let pass = true;
    for (const [k, v] of Object.entries(tc.expectedAttr)) {
        if (actualParams.attributes[k] !== v) {
            console.error(`❌ Mismatch for key ${k}: expected ${v}, got ${actualParams.attributes[k]}`);
            pass = false;
        }
    }
    if (actualParams.brand !== undefined) {
        console.error(`❌ Top-level brand parameter should have been deleted`);
        pass = false;
    }

    if (pass) console.log('✅ Pass');
});
