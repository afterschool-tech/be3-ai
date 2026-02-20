/**
 * Verify clause-aware stripping in parameterExtractor.
 */
const { extractDeterministic } = require('../src/services/intentResolver/pipeline/parameterExtractor');

const testCases = [
    {
        name: 'Clause before product (standard)',
        text: 'show me cheap airpods',
        candidates: [{ intentName: 'product_search' }],
        expect: { product: 'airpods', hasClauses: true }
    },
    {
        name: 'Clause before category (laptops)',
        text: 'show me cheap laptops',
        candidates: [{ intentName: 'product_search' }],
        expect: { category: true, product: undefined, hasClauses: true }
    },
    {
        name: 'Multiple clauses before category (phones)',
        text: 'show me cheap premium phones',
        candidates: [{ intentName: 'product_search' }],
        expect: { category: true, product: undefined, hasClauses: true }
    },
    {
        name: 'No clause - just product',
        text: 'show me headphones',
        candidates: [{ intentName: 'product_search' }],
        expect: { product: 'headphones', hasClauses: false }
    },
    {
        name: 'Brand clause + category (apple + phones)',
        text: 'show me apple phones',
        candidates: [{ intentName: 'product_search' }],
        expect: { category: true, product: undefined, hasClauses: true }
    },
    {
        name: 'Affordable clause',
        text: 'i want affordable earbuds',
        candidates: [{ intentName: 'product_search' }],
        expect: { product: 'earbuds', hasClauses: true }
    },
    {
        name: 'Budget clause',
        text: 'find me budget gaming mouse',
        candidates: [{ intentName: 'product_search' }],
        expect: { category: true, product: 'mouse', hasClauses: true }
    },
    {
        name: 'Expensive clause',
        text: 'show expensive headphones',
        candidates: [{ intentName: 'product_search' }],
        expect: { product: 'headphones', hasClauses: true }
    }
];

// We need storeContext with CATEGORIES for the product_search path
const { CATEGORIES } = require('../src/context/storeContext');
const storeContext = { CATEGORIES };

console.log('=== CLAUSE-AWARE STRIPPING TESTS ===\n');

let passed = 0;
let failed = 0;

for (const tc of testCases) {
    const result = extractDeterministic(tc.text, tc.candidates, storeContext);

    const productMatch = result.product_name === tc.expect.product;
    const clauseMatch = (!!result.clause_words && result.clause_words.length > 0) === tc.expect.hasClauses;
    const categoryMatch = tc.expect.category ? !!result.category : (!result.category);

    const ok = productMatch && clauseMatch && categoryMatch;

    if (ok) {
        console.log(`✅ ${tc.name}`);
        passed++;
    } else {
        console.log(`❌ ${tc.name}`);
        console.log(`   Input:    "${tc.text}"`);
        console.log(`   Result:   ${JSON.stringify(result, null, 2)}`);
        console.log(`   Expected: product="${tc.expect.product}" hasClauses=${tc.expect.hasClauses} hasCategory=${!!tc.expect.category}`);
        failed++;
    }
}

console.log(`\nResults: ${passed} passed, ${failed} failed out of ${testCases.length}`);
