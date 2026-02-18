/**
 * Hybrid Intent Resolver — Offline Unit Tests
 * Tests every pipeline stage independently and end-to-end.
 * Uses mock AI and mock state — no server, no API, no Redis needed.
 */

const { resolveAndMap } = require('../src/services/intentResolver');

// ═══════════════════════════════════════════════════
//  Mock AI Query Function
// ═══════════════════════════════════════════════════
async function mockAiQuery(messages) {
    // Simulate AI extracting products and query from the user message
    const userMsg = messages.find(m => m.role === 'user')?.content || '';

    // Parse the original user text from the AI prompt
    const textMatch = userMsg.match(/\"(.*?)\"/);
    const text = textMatch ? textMatch[1] : '';

    // Simple mock: extract quoted-like product names
    const products = [];
    const knownProducts = ['iphone 12', 'galaxy s23', 'iphone xs max', 'infinix hot 30 i', 'macbook pro'];
    for (const product of knownProducts) {
        if (text.toLowerCase().includes(product)) {
            products.push(product);
        }
    }

    return JSON.stringify({
        products: products.length > 0 ? products : null,
        product_name: text || null,
        query: text || null,
        category: null,
        vendor: null,
        attributes: null
    });
}

// ═══════════════════════════════════════════════════
//  Mock State (simulates stateManager output)
// ═══════════════════════════════════════════════════
const mockState = {
    reference_map: {
        it: 'prod-001',
        this: 'prod-001',
        that: 'prod-002',
        the_first_one: 'prod-001',
        the_second_one: 'prod-002',
        first: 'prod-001',
        second: 'prod-002',
        the_cheap_one: 'prod-002',
        the_cheapest: 'prod-002',
        the_expensive_one: 'prod-001',
        the_most_expensive: 'prod-001',
        the_one: 'prod-001',
        this_one: 'prod-001',
        that_one: 'prod-001',
        them: 'prod-001',
        all_of_them: 'prod-001,prod-002',
        the_products: 'prod-001,prod-002',
        iphone_xs_max: 'prod-001',
        infinix_hot_30_i: 'prod-002'
    },
    ordinal_list: ['prod-001', 'prod-002'],
    product_context: {
        currently_viewing: 'prod-001',
        last_search: {
            query: 'phones',
            results: [
                { id: 'prod-001', handle: 'prod-001', name: 'Iphone XS Max', price: 450000 },
                { id: 'prod-002', handle: 'prod-002', name: 'Infinix Hot 30 i', price: 85000 }
            ]
        }
    },
    current_intent: null,
    last_tools: [],
    cart: { item_count: 0 }
};

// ═══════════════════════════════════════════════════
//  Mock Store Context
// ═══════════════════════════════════════════════════
const mockStoreContext = {
    CATEGORIES: {
        phones: { id: 'cat-001', label: 'Phones', slug: 'phones', total_count: 25 },
        laptops: { id: 'cat-002', label: 'Laptops', slug: 'laptops', total_count: 15 }
    },
    VENDORS: {
        apple: { label: 'Apple' },
        samsung: { label: 'Samsung' },
        infinix: { label: 'Infinix' }
    }
};

// ═══════════════════════════════════════════════════
//  Test Runner
// ═══════════════════════════════════════════════════
let passed = 0;
let failed = 0;

function assert(condition, testName, details = '') {
    if (condition) {
        console.log(`  ✅ ${testName}`);
        passed++;
    } else {
        console.log(`  ❌ ${testName} ${details}`);
        failed++;
    }
}

async function runTests() {
    console.log('\n═══════════════════════════════════════════════');
    console.log('  Hybrid Intent Resolver — Unit Tests');
    console.log('═══════════════════════════════════════════════\n');

    // ─── Test 1: Simple single intent ───
    console.log('Test 1: Simple single intent — "Add iPhone 12 to cart"');
    const t1 = await resolveAndMap('Add iPhone 12 to cart', mockState, mockAiQuery, mockStoreContext);
    assert(t1.intents.length === 1, 'Detects 1 intent');
    assert(t1.intents[0]?.intentName === 'add_to_cart', 'Intent is add_to_cart');
    assert(t1.tools.length === 1, 'Maps to 1 tool');
    assert(t1.tools[0]?.tool === 'cart.add', 'Tool is cart.add');
    assert(t1.isMultiIntent === false, 'Not multi-intent');
    console.log('');

    // ─── Test 2: Multi-intent with conjunction ───
    console.log('Test 2: Multi-intent — "Add iPhone 12 to cart and check order #12345"');
    const t2 = await resolveAndMap('Add iPhone 12 to cart and check order #12345', mockState, mockAiQuery, mockStoreContext);
    assert(t2.isMultiIntent === true, 'Detects multi-intent');
    assert(t2.intents.length === 2, 'Has 2 intents');
    assert(t2.tools.length === 2, 'Maps to 2 tools');
    console.log('');

    // ─── Test 3: View cart (no params needed) ───
    console.log('Test 3: No params — "show my cart"');
    const t3 = await resolveAndMap('show my cart', mockState, mockAiQuery, mockStoreContext);
    assert(t3.intents.length >= 1, 'Detects intent');
    assert(t3.intents[0]?.intentName === 'view_cart', 'Intent is view_cart');
    assert(t3.tools[0]?.tool === 'cart.view', 'Tool is cart.view');
    console.log('');

    // ─── Test 4: Negation ───
    console.log('Test 4: Negation — "don\'t add iPhone 12 to cart"');
    const t4 = await resolveAndMap("don't add iPhone 12 to cart", mockState, mockAiQuery, mockStoreContext);
    assert(t4.intents.length >= 1, 'Detects intent');
    assert(t4.intents[0]?.intentName === 'remove_from_cart', 'Inverted to remove_from_cart');
    console.log('');

    // ─── Test 5: Context resolution — pronoun ───
    console.log('Test 5: Pronoun resolution — "add it to cart"');
    const t5 = await resolveAndMap('add it to cart', mockState, mockAiQuery, mockStoreContext);
    assert(t5.resolutions.length >= 1, 'Has resolutions');
    assert(t5.resolutions[0]?.original === 'it', 'Resolved "it"');
    assert(t5.resolutions[0]?.resolved === 'Iphone XS Max', 'Resolved to Iphone XS Max');
    assert(t5.corrections.afterContext.includes('Iphone XS Max'), 'Context-resolved text includes product name');
    console.log('');

    // ─── Test 6: Order tracking with regex extraction ───
    console.log('Test 6: Order tracking — "check status of order #45678"');
    const t6 = await resolveAndMap('check status of order #45678', mockState, mockAiQuery, mockStoreContext);
    assert(t6.intents.length >= 1, 'Detects intent');
    assert(t6.intents[0]?.intentName === 'order_status', 'Intent is order_status');
    console.log('');

    // ─── Test 7: Fuzzy correction ───
    console.log('Test 7: Fuzzy correction — "ad iPhoen to kart"');
    const t7 = await resolveAndMap('ad iPhoen to kart', mockState, mockAiQuery, mockStoreContext);
    assert(t7.corrections.original === 'ad iPhoen to kart', 'Preserves original');
    assert(t7.corrections.afterFuzzy !== t7.corrections.original, 'Fuzzy correction applied');
    console.log('');

    // ─── Test 8: Product comparison (conjunction guard) ───
    console.log('Test 8: Comparison — "compare iPhone 12 and Galaxy S23"');
    const t8 = await resolveAndMap('compare iPhone 12 and Galaxy S23', mockState, mockAiQuery, mockStoreContext);
    assert(t8.isMultiIntent === false, 'NOT multi-intent (conjunction guard protects "and")');
    assert(t8.intents.length >= 1, 'Detects intent');
    const compareIntent = t8.intents.find(i => i.intentName === 'product_compare');
    assert(compareIntent !== undefined, 'Detects product_compare intent');
    console.log('');

    // ─── Individual Module Tests ───
    console.log('── Individual Module Tests ──\n');

    // Preprocessor
    console.log('Test 9: Preprocessor — conjunction splitting');
    const { preprocess } = require('../src/services/intentResolver/pipeline/preprocessor');
    const p1 = preprocess('add iphone to cart and check my order');
    assert(p1.isMultiIntent === true, 'Detects multi-intent');
    assert(p1.statements.length === 2, 'Splits into 2 statements');
    // Guard test: "compare" before "and" should NOT split
    const p2 = preprocess('compare iphone and galaxy');
    assert(p2.isMultiIntent === false, 'Conjunction guard: compare + and = no split');
    assert(p2.statements.length === 1, 'Guards keep it as 1 statement');

    // Regression test: "then" should split even if "compare" is present
    const p3 = preprocess('compare iphone and galaxy then add to cart');
    assert(p3.statements.length === 2, '"compare... then..." splits into 2 statements');
    assert(p3.statements[0].text === 'compare iphone and galaxy', 'First part kept intact');
    assert(p3.statements[1].text === 'add to cart', 'Second part split correctly');

    console.log('');

    // Candidate Detector
    console.log('Test 10: Candidate Detector — keyword matching');
    const { detectCandidates } = require('../src/services/intentResolver/pipeline/candidateDetector');
    const c1 = detectCandidates({ text: 'add iphone 12 to cart', negated: false });
    assert(c1.length >= 1, 'Finds candidates');
    assert(c1[0]?.intentName === 'add_to_cart', 'Top candidate is add_to_cart');
    console.log('');

    // Tool Mapper Expansion
    console.log('Test 14: Tool Mapper — List Expansion');
    const { mapToTools } = require('../src/services/intentResolver/pipeline/toolMapper');
    const multiItemIntent = {
        intentName: 'add_to_cart',
        score: 1.0,
        parameters: { products: ['iphone', 'galaxy'], quantity: 1 }
    };
    const tools = mapToTools([multiItemIntent]);
    assert(tools.length === 2, 'Expands 1 intent into 2 tool calls');
    assert(tools[0].params.product_id === 'iphone', 'First call has product 1');
    assert(tools[1].params.product_id === 'galaxy', 'Second call has product 2');
    assert(tools[0].params.quantity === 1, 'First call has quantity');

    console.log('');

    // Levenshtein
    console.log('Test 11: Levenshtein distance');
    const { levenshtein } = require('../src/services/intentResolver/utils/levenshtein');
    assert(levenshtein('cart', 'kart') === 1, 'cart → kart = 1');
    assert(levenshtein('add', 'ad') === 1, 'add → ad = 1');
    assert(levenshtein('compare', 'compre') === 1, 'compare → compre = 1');
    assert(levenshtein('', 'abc') === 3, 'empty → abc = 3');
    assert(levenshtein('same', 'same') === 0, 'same → same = 0');
    console.log('');

    // Intent Registry
    console.log('Test 12: Intent Registry');
    const intentRegistry = require('../src/services/intentResolver/config/intentRegistry');
    const allIntents = intentRegistry.getAll();
    assert(Object.keys(allIntents).length === 7, 'Registry has 7 intents');
    assert(intentRegistry.get('add_to_cart') !== null, 'Can get add_to_cart');
    assert(intentRegistry.get('nonexistent') === null, 'Returns null for unknown');
    const keywordMap = intentRegistry.buildKeywordMap();
    assert(keywordMap['cart'] !== undefined, 'Keyword map has "cart"');
    console.log('');

    // Parameter Extractor — deterministic
    console.log('Test 13: Deterministic parameter extraction');
    const { extractDeterministic } = require('../src/services/intentResolver/pipeline/parameterExtractor');
    const det1 = extractDeterministic('add 3 iphone 12 to cart');
    assert(det1.quantity === 3, 'Extracts quantity=3 from "add 3"');
    const det1b = extractDeterministic('i want iphone 6');
    assert(det1b.quantity === undefined, 'Does NOT treat model number "6" as quantity');
    const det2 = extractDeterministic('check order #45678');
    assert(det2.order_id === '45678', 'Extracts order_id=45678');
    const det3 = extractDeterministic('phones under $500');
    assert(det3.price_max === 500, 'Extracts price_max=500');
    console.log('');

    // ─── Summary ───
    console.log('\n═══════════════════════════════════════════════');
    console.log(`  Results: ${passed} passed, ${failed} failed`);
    console.log('═══════════════════════════════════════════════\n');

    process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
    console.error('Test runner crashed:', err);
    process.exit(1);
});
