/**
 * Schema Resolver Verification Suite
 * Tests the new Slot-Driven Intent Resolution pipeline.
 */

const { extractEntities } = require('../src/services/intentResolver/pipeline/entityExtractor');
const { resolveIntent } = require('../src/services/intentResolver/pipeline/schemaResolver');
const intentRegistry = require('../src/services/intentResolver/config/intentRegistry');
const storeContext = require('../src/context/storeContext');

const idfMap = intentRegistry.buildIdfMap();

const testCases = [
    { query: 'i need Dareymi contact', expected: 'vendor_contact' },
    { query: 'i need Taye Home Decor products', expected: 'vendor_products' },
    { query: 'show me cheap phones', expected: 'product_search' },
    { query: 'track my order #12345', expected: 'order_status' },
    { query: 'add 2 iphones to cart', expected: 'add_to_cart' },
    { query: 'remove iphone from cart', expected: 'remove_from_cart' },
    { query: 'what is in my cart', expected: 'view_cart' },
    { query: 'compare iphone and samsung', expected: 'product_compare' },
    { query: 'help me', expected: 'get_help' },
    { query: 'list all vendors', expected: 'list_vendors' },
    { query: 'checkout', expected: 'start_checkout' },
    { query: 'cancel my order', expected: 'cancel_order' },
    { query: 'show delivery options', expected: 'set_delivery' },
    { query: 'confirm order', expected: 'confirm_order' },
    { query: 'bye', expected: 'end_conversation' },
    { query: 'give feedback', expected: 'give_feedback' },
    { query: 'recommend a phone for me', expected: 'get_advice' },
    { query: 'is iphone available', expected: 'check_availability' },
    { query: 'show my orders', expected: 'list_orders' },
    { query: 'who sells this', expected: 'vendor_identity' },
    { query: 'tell me about Dareymi', expected: 'vendor_info' },
];

let passed = 0;
let failed = 0;

console.log('🧪 Schema Resolver Verification Suite\n');
console.log('='.repeat(70));

for (const tc of testCases) {
    const extraction = extractEntities(tc.query, storeContext, idfMap);
    const result = resolveIntent(extraction, tc.query, idfMap, storeContext);

    const actual = result.winner?.intentName || 'NO_MATCH';
    const status = actual === tc.expected ? '✅' : '❌';

    if (actual === tc.expected) {
        passed++;
    } else {
        failed++;
    }

    const entities = extraction.entities.map(e => `${e.type}:${e.value || e.verb}`).join(', ');
    const top3 = result.candidates.slice(0, 3).map(c => `${c.intentName}(${c.score.toFixed(1)})`).join(' > ');

    console.log(`${status} "${tc.query}"`);
    console.log(`   Expected: ${tc.expected} | Got: ${actual} (score: ${result.winner?.score?.toFixed(2) || 'N/A'})`);
    console.log(`   Entities: [${entities}]`);
    console.log(`   Top 3: ${top3}`);
    if (result.fallbackUsed) console.log(`   ⚠️  Semantic fallback used`);
    console.log('');
}

console.log('='.repeat(70));
console.log(`\n📊 Results: ${passed}/${testCases.length} passed, ${failed} failed`);
