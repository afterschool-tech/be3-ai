/**
 * V2 Intent System Verification Test
 * Validates all 23 intents load correctly, Data Contract scoring works,
 * and the modular bench infrastructure is intact.
 * 
 * Usage: node tests/test_v2_intents.js
 */

const path = require('path');
const fs = require('fs');

// --- Helpers ---
let passed = 0;
let failed = 0;
function assert(condition, label) {
    if (condition) {
        console.log(`  ✅ ${label}`);
        passed++;
    } else {
        console.log(`  ❌ FAIL: ${label}`);
        failed++;
    }
}

// =============================================
// TEST 1: Intent Registry — All 23 intents load
// =============================================
console.log('\n📋 TEST 1: Intent Registry completeness');

const intentRegistry = require('../src/services/intentResolver/config/intentRegistry');
const allIntents = intentRegistry.getAll();
const intentNames = Object.keys(allIntents);

console.log(`  Loaded ${intentNames.length} intents.`);

const expectedIntents = [
    // V1 (existing)
    'add_to_cart', 'remove_from_cart', 'view_cart', 'product_search',
    'product_compare', 'check_availability', 'order_status',
    // V2 (new)
    'update_cart_quantity', 'start_checkout', 'browse_collection',
    'get_help', 'end_conversation', 'give_feedback', 'get_advice',
    'list_orders', 'cancel_order', 'set_delivery', 'confirm_order',
    'vendor_products', 'vendor_info', 'vendor_contact', 'vendor_identity',
    'discovery_sentinel'
];

assert(intentNames.length >= expectedIntents.length, `Registry has ${intentNames.length} intents (expected ${expectedIntents.length}+)`);

for (const name of expectedIntents) {
    assert(intentNames.includes(name), `Intent "${name}" is registered`);
}

// =============================================
// TEST 2: Tool Mappings — Every intent maps to a valid tool
// =============================================
console.log('\n🔧 TEST 2: Tool Mappings');

const toolFiles = ['product', 'cart', 'collection', 'conversation', 'discovery', 'order', 'vendor'];
const allTools = {};
for (const tf of toolFiles) {
    try {
        const tools = require(`../src/tools/${tf}`);
        Object.assign(allTools, tools);
    } catch (e) {
        console.log(`  ⚠️  Could not load tools/${tf}.js: ${e.message}`);
    }
}

const allToolNames = Object.keys(allTools);
console.log(`  Loaded ${allToolNames.length} tools across ${toolFiles.length} files.`);

for (const [name, intent] of Object.entries(allIntents)) {
    assert(allToolNames.includes(intent.toolName), `"${name}" → "${intent.toolName}" exists`);
}

// =============================================
// TEST 3: Data Contract — Required params defined
// =============================================
console.log('\n📄 TEST 3: Data Contract Validation');

const intentsWithRequiredParams = [
    { name: 'update_cart_quantity', requiredParams: ['products', 'quantity'] },
    { name: 'browse_collection', requiredParams: ['collection_slug'] },
    { name: 'cancel_order', requiredParams: ['order_number'] },
    { name: 'vendor_products', requiredParams: ['vendor'] },
    { name: 'vendor_info', requiredParams: ['vendor'] },
    { name: 'vendor_contact', requiredParams: ['vendor'] },
    { name: 'vendor_identity', requiredParams: ['product_name'] },
    { name: 'product_search', requiredParams: ['product_name'] }
];

for (const { name, requiredParams } of intentsWithRequiredParams) {
    const intent = intentRegistry.get(name);
    assert(intent !== null, `Intent "${name}" exists`);
    if (intent) {
        for (const param of requiredParams) {
            assert(
                intent.parameters[param] && intent.parameters[param].required === true,
                `"${name}.${param}" is required: true`
            );
        }
    }
}

// =============================================
// TEST 4: Precision Scoring — Verify Data Contract penalty
// =============================================
console.log('\n⚖️ TEST 4: Precision Scoring (Data Contract Penalty)');

const { scoreIntents } = require('../src/services/intentResolver/pipeline/intentScorer');

// Scenario: "cancel order" matched to cancel_order AND list_orders
// cancel_order requires order_number, list_orders does not
const cancelCandidates = [
    { intentName: 'cancel_order', matchedKeywords: ['cancel'], keywordScore: 1 },
    { intentName: 'list_orders', matchedKeywords: ['orders'], keywordScore: 1 }
];

// WITHOUT order_number → cancel_order should be penalized
const resultNoOrderNum = scoreIntents(cancelCandidates, {}, {});
assert(
    resultNoOrderNum && resultNoOrderNum.intentName === 'list_orders',
    `Without order_number: winner is "list_orders" (not cancel_order which needs it)`
);

// WITH order_number → cancel_order should win (action verb "cancel" = 5x)
const resultWithOrderNum = scoreIntents(cancelCandidates, { order_number: '12345' }, {});
assert(
    resultWithOrderNum && resultWithOrderNum.intentName === 'cancel_order',
    `With order_number: winner is "cancel_order" (has required param + verb)`
);

// =============================================
// TEST 5: Verb-Noun Weighting
// =============================================
console.log('\n🏋️ TEST 5: Verb-Noun Weighting');

// Scenario: "add MacBook to cart" — add_to_cart has keyword "add" (5x), view_cart has keyword "cart" (5x)
// But add_to_cart also matches "cart" synonym (1x). Total: add=6, view=5
const cartCandidates = [
    { intentName: 'add_to_cart', matchedKeywords: ['add', 'cart'], keywordScore: 2 },
    { intentName: 'view_cart', matchedKeywords: ['cart'], keywordScore: 1 }
];

const cartResult = scoreIntents(cartCandidates, { products: ['macbook'] }, {});
assert(
    cartResult && cartResult.intentName === 'add_to_cart',
    `"add to cart" → add_to_cart wins (verb "add" gets 5x boost)`
);

// =============================================
// TEST 6: Modular Bench Infrastructure
// =============================================
console.log('\n📦 TEST 6: Modular Bench Infrastructure');

const INTENTS_DIR = path.join(__dirname, '../src/services/intentResolver/semanticLab/intents');

// Check joint_bench.json exists  
const jointBenchPath = path.join(INTENTS_DIR, 'joint_bench.json');
assert(fs.existsSync(jointBenchPath), 'joint_bench.json exists');

if (fs.existsSync(jointBenchPath)) {
    const jointBench = JSON.parse(fs.readFileSync(jointBenchPath, 'utf8'));
    const benchIntents = Object.keys(jointBench);
    assert(benchIntents.length >= 7, `Joint bench has ${benchIntents.length} intents (minimum 7 from migration)`);
}

// Check per-intent folders exist
const expectedFolders = ['add_to_cart', 'product_search', 'view_cart', 'remove_from_cart', 'order_status', 'check_availability', 'product_compare'];
for (const folder of expectedFolders) {
    const folderPath = path.join(INTENTS_DIR, folder);
    const benchFile = path.join(folderPath, 'bench.json');
    assert(fs.existsSync(folderPath), `Folder "${folder}/" exists`);
    assert(fs.existsSync(benchFile), `"${folder}/bench.json" exists`);
}

// Check orchestrators exist
assert(fs.existsSync(path.join(INTENTS_DIR, 'joint_sync.js')), 'joint_sync.js exists');
assert(fs.existsSync(path.join(INTENTS_DIR, 'joint_prune.js')), 'joint_prune.js exists');
assert(fs.existsSync(path.join(INTENTS_DIR, 'migrate.js')), 'migrate.js exists');

// =============================================
// TEST 7: Product Search Pruning
// =============================================
console.log('\n✂️ TEST 7: Product Search Synonym Pruning');

const productSearch = intentRegistry.get('product_search');
const psSynonyms = productSearch.synonyms.map(s => s.toLowerCase());

const removedSynonyms = ['buy', 'get', 'want', 'purchase', 'i want to buy', 'let me buy', 'cop', 'gimme'];
for (const removed of removedSynonyms) {
    assert(!psSynonyms.includes(removed), `"${removed}" removed from product_search synonyms`);
}

const keptSynonyms = ['show me', 'looking for', 'do you have', 'help me find'];
for (const kept of keptSynonyms) {
    assert(psSynonyms.includes(kept), `"${kept}" still in product_search synonyms`);
}

// =============================================
// SUMMARY
// =============================================
console.log(`\n${'='.repeat(50)}`);
console.log(`📊 Results: ${passed} passed, ${failed} failed out of ${passed + failed} total`);
console.log(`${'='.repeat(50)}`);

if (failed > 0) {
    console.log('\n⚠️  Some tests failed! Review failures above.');
    process.exit(1);
} else {
    console.log('\n✨ All V2 verification tests passed!');
}
