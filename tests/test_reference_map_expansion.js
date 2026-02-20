/**
 * Test: Reference Map + Category/Clause Resolution
 *
 * Documents how reference_map, search_context, and contextReconciler operate,
 * and tests category-based ("add the iphones") and clause-based ("add the cheap ones") flows.
 *
 * Run: node tests/test_reference_map_expansion.js
 */

const stateManager = require('../src/state/stateManager');
const { resolveAndMap } = require('../src/services/intentResolver');
const storeContext = require('../src/context/storeContext');
const { executeTools } = require('../src/core/orchestrator');

const SESSION = 'test_ref_expansion_' + Date.now();

// Resolve iphones category once
const iphonesCat = storeContext.CATEGORIES?.iphones || Object.values(storeContext.CATEGORIES || {}).find(c => c.slug === 'iphones');
const IPHONES_CAT_ID = iphonesCat?.id;

// Mock AI - not used when we have deterministic extraction
const mockAi = null;

// ═══════════════════════════════════════════════════════════════════
// HOW REFERENCE MAP & CONTEXT RESOLUTION OPERATE
// ═══════════════════════════════════════════════════════════════════
/**
 * reference_map (populated by stateManager.updateReferenceMap from product search results):
 *
 * 1. ORDINALS (set overwrite, or accumulation for single results):
 *    - first, second, third, the_first_one, the_second_one, the_third_one
 *
 * 2. PLURALS (point to comma-separated product IDs):
 *    - them, all, the_products, all_of_them, ones, the_ones
 *
 * 3. SINGULARS (point to first/latest product):
 *    - it, this, that, the_one
 *
 * 4. PRICE-BASED (single product, from sorted prices):
 *    - the_cheapest → lowest-priced product ID
 *    - the_most_expensive → highest-priced product ID
 *
 * 5. PRODUCT NAME SLUGS (cumulative):
 *    - product name lowercased, spaces→underscores: macbook_air, iphone_15
 *
 * 6. BRAND SLUGS (if product name contains brand):
 *    - iphone, samsung, apple, macbook, the_iphone, the_iphone_one
 *
 * 7. VENDOR SLUGS (if product has vendor):
 *    - vendor_slug, the_vendor_slug_one
 *
 * search_context (setSearchContext) - stores category_id, clauses, product_ids.
 * Populated after product_search (WRITE). product_ids filled by product tool after execution.
 * Used by Stage 8a READ: injects product_ids when clause/category/pronoun matches.
 *
 * Stage 8a READ - for add_to_cart/product_compare/check_availability:
 *   - "the cheap ones": when params.clause_words matches searchCtx.clauses → inject product_ids
 *   - "the iphones" / category: when params.category === searchCtx.category_id → inject product_ids
 *   - "add them" / "the ones": when pronoun detected → inject product_ids
 *
 * contextReconciler - resolves "add the iphones" (category label) when:
 *   - intent is add_to_cart/product_compare
 *   - parameters have category but products are generic/missing
 *   - last_search.results has products; filters by category_id
 *   → Maps to specific product IDs from last search. No new category search.
 *
 * GAP: "the cheap ones" / "the expensive ones" (clause-based plurals):
 *   - reference_map has the_cheapest, the_most_expensive (singular only)
 *   - No "cheap_ones", "the_cheap_ones", "expensive_ones" etc.
 *   - Would require expansion: clause words → product IDs (filter by clause)
 */

async function runTests() {
    await stateManager.clearState(SESSION);

    console.log('\n═══ REFERENCE MAP EXPANSION TESTS ═══\n');

    // ─── Test 1: reference_map ordinals + price-based ───
    console.log('--- Test 1: Ordinals + the_cheapest / the_most_expensive ---');
    await stateManager.updateReferenceMap(SESSION, [
        { id: 'p1', name: 'Budget Phone', price: 150 },
        { id: 'p2', name: 'Mid Phone', price: 400 },
        { id: 'p3', name: 'Flagship Phone', price: 1200 }
    ]);
    let state = await stateManager.getState(SESSION);
    const ordOK = state.reference_map.first === 'p1' && state.reference_map.second === 'p2' && state.reference_map.third === 'p3';
    const cheapOK = state.reference_map.the_cheapest === 'p1';
    const expOK = state.reference_map.the_most_expensive === 'p3';
    console.log('  first:', state.reference_map.first, ordOK ? '✓' : '✗');
    console.log('  the_cheapest:', state.reference_map.the_cheapest, cheapOK ? '✓' : '✗');
    console.log('  the_most_expensive:', state.reference_map.the_most_expensive, expOK ? '✓' : '✗');
    console.log(ordOK && cheapOK && expOK ? '  ✅ PASS' : '  ❌ FAIL');

    // ─── Test 2: reference_map brand slugs (e.g. "iphone") ───
    console.log('\n--- Test 2: Brand slug mapping (iphone) ---');
    await stateManager.updateReferenceMap(SESSION, [
        { id: 'iph-1', name: 'iPhone 15 Pro', price: 999 },
        { id: 'iph-2', name: 'iPhone 14', price: 699 }
    ]);
    state = await stateManager.getState(SESSION);
    const iphoneSlug = state.reference_map.iphone; // brand loop: product.name includes 'iphone'
    const iphone15Slug = state.reference_map.iphone_15_pro; // product name slug
    console.log('  iphone →', iphoneSlug, iphoneSlug ? '✓' : '✗');
    console.log('  iphone_15_pro →', iphone15Slug, iphone15Slug ? '✓' : '✗');
    console.log((iphoneSlug || iphone15Slug) ? '  ✅ PASS' : '  ❌ FAIL');

    // ─── Test 3: contextResolver replaces "the first one" with product name ───
    // Needs last_search.results so resolveIdToName can map productId → name
    console.log('\n--- Test 3: contextResolver text replacement ---');
    state.product_context = state.product_context || {};
    state.product_context.last_search = {
        results: [
            { id: 'iph-1', name: 'iPhone 15 Pro' },
            { id: 'iph-2', name: 'iPhone 14' }
        ]
    };
    const { resolveReferences } = require('../src/services/intentResolver/pipeline/contextResolver');
    const { resolvedText, resolutions } = resolveReferences('add the first one to cart', state);
    const hasResolution = resolutions.some(r => r.original && r.productId);
    console.log('  Input: "add the first one to cart"');
    console.log('  Resolved:', resolvedText);
    console.log('  Resolutions:', resolutions.length, hasResolution ? '✓' : '✗');
    console.log(hasResolution || resolvedText !== 'add the first one to cart' ? '  ✅ PASS' : '  ❌ FAIL');

    // ─── Test 4: Full pipeline - "add the cheapest" → add_to_cart ───
    // reference_map.the_cheapest should resolve via contextResolver; product_id should be UUID not "cheapest"
    console.log('\n--- Test 4: "add the cheapest" (reference_map.the_cheapest) ---');
    const r4 = await resolveAndMap('add the cheapest to cart', state, mockAi, storeContext);
    const tool4 = r4.tools?.find(t => t.tool?.includes('cart.add') || t.tool?.includes('add'));
    const params4 = tool4?.params || {};
    const productId4 = params4.product_id || params4.products?.[0];
    const expectedCheapest = state.reference_map.the_cheapest;
    const isResolved = productId4 && productId4 !== 'cheapest'; // Resolved to product name or ID (not literal "cheapest")
    console.log('  Intent:', r4.intents?.[0]?.intentName);
    console.log('  product_id:', productId4, '| the_cheapest:', expectedCheapest);
    console.log(isResolved ? '  ✅ PASS (resolved to product; may be name or ID)' : '  ❌ FAIL (product_id should not be literal "cheapest")');

    // ─── Test 5: Category reconciliation - "add the iphones" (contextReconciler) ───
    // contextReconciler resolves category labels to product IDs from last_search when
    // products are generic (e.g. "iphones"). No new category search.
    console.log('\n--- Test 5: Category reconciliation ("add the iphones") ---');
    if (!IPHONES_CAT_ID) {
        console.log('  ⏭️  SKIP (no iphones category in storeContext)');
    } else {
        state = await stateManager.getState(SESSION);
        state.product_context = state.product_context || {};
        state.product_context.last_search = {
            query: 'iphones',
            results: [
                { id: 'iph-1', name: 'iPhone 15 Pro', category_id: IPHONES_CAT_ID, category: IPHONES_CAT_ID, price: 999 },
                { id: 'iph-2', name: 'iPhone 14', category_id: IPHONES_CAT_ID, category: IPHONES_CAT_ID, price: 699 }
            ]
        };
        await stateManager.setState(SESSION, state);

        const r5 = await resolveAndMap('add the iphones to cart', state, mockAi, storeContext);
        const intent5 = r5.intents?.[0];
        const reconciled = r5.reconciledFromContext;
        const productId = intent5?.parameters?.product_id || intent5?.parameters?.products?.[0];
        console.log('  Intent:', intent5?.intentName);
        console.log('  Reconciled from context:', reconciled);
        console.log('  product_id:', productId);
        console.log(productId && (productId === 'iph-1' || productId === 'iph-2') ? '  ✅ PASS' : '  ❌ FAIL (expected product from last_search by category)');
    }

    // ─── Test 6: "add the cheap ones" (Stage 8a READ: clause + search_context) ───
    // "The cheap ones" is resolved via search_context when clause_words matches searchCtx.clauses.
    console.log('\n--- Test 6: "add the cheap ones" (search_context + clause match) ---');
    const affordableClauseId = 'affordable'; // from CLAUSES
    state = await stateManager.getState(SESSION);
    await stateManager.setSearchContext(SESSION, {
        category: 'Smartphones',
        category_id: IPHONES_CAT_ID || '9407551c-0204-4ffb-a054-1709177ebafc',
        clauses: [affordableClauseId],
        product_ids: ['iph-1', 'iph-2'],
        query: 'cheap smartphones',
        ttl_messages: 10
    });

    const r6 = await resolveAndMap('add the cheap ones to cart', state, mockAi, storeContext);
    const intent6 = r6.intents?.[0];
    const hasContextProducts = intent6?.parameters?.products?.length || intent6?.parameters?._context_product_ids?.length;
    console.log('  Intent:', intent6?.intentName);
    console.log('  products/_context_product_ids:', intent6?.parameters?.products || intent6?.parameters?._context_product_ids);
    console.log(hasContextProducts ? '  ✅ PASS (Stage 8a injected product_ids from clause match)' : '  ❌ FAIL');

    console.log('\n═══ DONE ═══\n');
}

runTests().catch(err => {
    console.error(err);
    process.exit(1);
});
