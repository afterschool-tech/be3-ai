/**
 * Verify Structural Matcher extraction
 */
const structuralMatcher = require('../src/services/intentResolver/semanticLab/structural/utils/StructuralMatcher');

const testCases = [
    {
        name: 'Simple product search',
        text: 'find me some cheap iphone 12',
        expect: { intent: 'product_search', product: 'iphone 12' }
    },
    {
        name: 'Add to cart with quantity',
        text: 'add 3 milk to cart',
        expect: { intent: 'add_to_cart', product: 'milk', quantity: '3' }
    },
    {
        name: 'Vendor search',
        text: 'show items by apple',
        expect: { intent: 'vendor_products', vendor: 'apple' }
    },
    {
        name: 'Comparison',
        text: 'iphone 13 vs samsung s22',
        expect: { intent: 'product_compare', product1: 'iphone 13', product2: 'samsung s22' }
    },
    {
        name: 'Check availability with clause',
        text: 'is the blue headset in stock?',
        expect: { intent: 'check_availability', product: 'headset' }
    }
];

console.log('=== STRUCTURAL MATCHER VERIFICATION ===\n');

let passed = 0;
let failed = 0;

for (const tc of testCases) {
    const matches = structuralMatcher.findMatches(tc.text);
    const best = matches[0];

    if (!best) {
        console.log(`❌ ${tc.name} (No match found)`);
        failed++;
        continue;
    }

    const intentOk = best.intentName === tc.expect.intent;
    let paramsOk = true;

    // Check specific params for these tests
    if (tc.expect.product && best.groups.product_name !== tc.expect.product) paramsOk = false;
    if (tc.expect.quantity && best.groups.quantity !== tc.expect.quantity) paramsOk = false;
    if (tc.expect.vendor && best.groups.vendor !== tc.expect.vendor) paramsOk = false;
    if (tc.expect.product1 && best.groups.product_name !== tc.expect.product1) paramsOk = false;
    if (tc.expect.product2 && best.groups.product_name_2 !== tc.expect.product2) paramsOk = false;

    if (intentOk && paramsOk) {
        console.log(`✅ ${tc.name}`);
        passed++;
    } else {
        console.log(`❌ ${tc.name}`);
        console.log(`   Input:    "${tc.text}"`);
        console.log(`   Template: "${best.template}"`);
        console.log(`   Confidence: ${best.confidence.toFixed(2)}`);
        console.log(`   Result:   ${JSON.stringify({ intent: best.intentName, groups: best.groups }, null, 2)}`);
        console.log(`   Expected: ${JSON.stringify(tc.expect, null, 2)}`);
        failed++;
    }
}

console.log(`\nResults: ${passed} passed, ${failed} failed out of ${testCases.length}`);
