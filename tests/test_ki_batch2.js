/**
 * Knowledge Injection Batch 2 — Verification Tests
 * 
 * Tests the next batch of KI features:
 *   1. Hallucination Guard (AI attribute validation)
 *   2. Hierarchy Boost (root category → discovery_sentinel)
 *   3. Vendor-Category Prioritization (vendor bias — future-proofed)
 *   4. Inventory Short-circuit (empty category detection)
 *   5. Sibling Suggestions (contextual alternatives)
 *   6. Parental Pivot (auto-broaden to parent)
 */

const { resolveAndMap } = require('../src/services/intentResolver/index');
const { CATEGORIES, VENDORS, ATTRIBUTES } = require('../src/context/storeContext');
const { findById, getParent, getSiblings, isRoot } = require('../src/context/categoryHelpers');

const storeContext = { CATEGORIES, VENDORS, ATTRIBUTES };

// ── Test Constants ──
const BUSINESS_LAPTOPS_ID = Object.values(CATEGORIES).find(c => c.label === 'Business Laptops')?.id;
const LAPTOPS_PARENT_ID = getParent(BUSINESS_LAPTOPS_ID)?.id; // Laptops & Computers
const GADGETS_ID = Object.values(CATEGORIES).find(c => c.label === 'Gadgets')?.id;
const FOOD_ID = Object.values(CATEGORIES).find(c => c.label === 'Food')?.id;

// Dummy AI (returns empty for testing deterministic paths)
const dummyAi = async () => '{}';

const tests = [
    // ═══ A1: Category Helpers ═══
    {
        name: 'Category Helpers: getParent, getSiblings, isRoot, getPath',
        skipPipeline: true,
        verify: () => {
            const parent = getParent(BUSINESS_LAPTOPS_ID);
            if (!parent) return { pass: false, reason: 'getParent returned null' };
            if (parent.label !== 'Laptops & Computers') return { pass: false, reason: `Expected parent 'Laptops & Computers', got '${parent.label}'` };

            const siblings = getSiblings(BUSINESS_LAPTOPS_ID);
            if (siblings.length === 0) return { pass: false, reason: 'getSiblings returned empty' };

            if (isRoot(BUSINESS_LAPTOPS_ID)) return { pass: false, reason: 'Business Laptops should NOT be root' };
            if (!isRoot(GADGETS_ID)) return { pass: false, reason: 'Gadgets SHOULD be root' };

            return { pass: true };
        }
    },

    // ═══ A2: Hallucination Guard ═══
    {
        name: 'Hallucination Guard: AI brand extraction blocked for Food',
        message: 'apple food',
        state: { user_id: 'ki2_test_hallucination' },
        verify: (result) => {
            const params = result.intents[0]?.parameters || {};
            // "apple" should NOT leak as brand for food (food doesn't support brand)
            const brandLeaked = !!(params.brand);
            if (brandLeaked) return { pass: false, reason: `Brand leaked: ${params.brand}` };
            return { pass: true };
        }
    },

    // ═══ B1: Hierarchy Boost ═══
    {
        name: 'Hierarchy Boost: Root category "gadgets" boosts discovery_sentinel',
        message: 'gadgets',
        state: { user_id: 'ki2_test_hierarchy' },
        verify: (result) => {
            const intent = result.intents[0];
            // discovery_sentinel should win or be competitive for root-only queries
            const isDiscovery = intent.intentName === 'discovery_sentinel' || intent.intentName === 'product_search';
            if (!isDiscovery) return { pass: false, reason: `Expected discovery/search intent, got '${intent.intentName}'` };
            return { pass: true };
        }
    },

    // ═══ B3: Inventory Short-circuit ═══
    {
        name: 'Inventory Short-circuit: "business laptops" flagged as empty',
        message: 'business laptops',
        state: { user_id: 'ki2_test_inventory' },
        verify: (result) => {
            const params = result.intents[0]?.parameters || {};
            // The category should either be flagged as empty or pivoted to parent
            const wasPivoted = !!params._pivoted_from;
            const flaggedEmpty = !!params._empty_category;
            if (!wasPivoted && !flaggedEmpty) {
                return { pass: false, reason: `Expected _empty_category flag or pivot. Params: ${JSON.stringify(params)}` };
            }
            return { pass: true };
        }
    },

    // ═══ C1: Sibling Suggestions ═══
    {
        name: 'Sibling Suggestions: Empty category gets sibling alternatives',
        message: 'show me business laptops',
        state: { user_id: 'ki2_test_siblings' },
        verify: (result) => {
            const params = result.intents[0]?.parameters || {};
            // ultrabooks should appear as a sibling with products
            const alts = params._suggested_alternatives || [];
            const hasSibling = alts.some(a => a.count > 0);
            if (alts.length === 0) {
                // Could also just be pivoted
                if (params._pivoted_from) return { pass: true };
                return { pass: false, reason: `No alternatives and no pivot. Params: ${JSON.stringify(params)}` };
            }
            if (!hasSibling) return { pass: false, reason: `Siblings have 0 products: ${JSON.stringify(alts)}` };
            return { pass: true };
        }
    },

    // ═══ C2: Parental Pivot ═══
    {
        name: 'Parental Pivot: "business laptops" → pivots to "Laptops & Computers"',
        message: 'search business laptops',
        state: { user_id: 'ki2_test_pivot' },
        verify: (result) => {
            const params = result.intents[0]?.parameters || {};
            if (!params._pivoted_from) {
                return { pass: false, reason: `No pivot occurred. category=${params.category}, Params: ${JSON.stringify(params)}` };
            }
            if (params._pivoted_to !== 'Laptops & Computers') {
                return { pass: false, reason: `Expected pivot to 'Laptops & Computers', got '${params._pivoted_to}'` };
            }
            if (params.category !== LAPTOPS_PARENT_ID) {
                return { pass: false, reason: `Category should be parent ID ${LAPTOPS_PARENT_ID}, got ${params.category}` };
            }
            return { pass: true };
        }
    }
];

// ── Runner ──
async function runTests() {
    console.log('🚀 Starting Knowledge Injection Batch 2 Verification...\n');

    let passed = 0;
    let failed = 0;

    for (const test of tests) {
        process.stdout.write(`Testing: ${test.name}\n`);

        try {
            let verifyResult;

            if (test.skipPipeline) {
                // Direct function test, no pipeline run
                verifyResult = test.verify();
            } else {
                const result = await resolveAndMap(
                    test.message,
                    test.state,
                    dummyAi,
                    storeContext
                );
                verifyResult = test.verify(result);
            }

            if (verifyResult.pass) {
                console.log(`   ✅ PASS`);
                passed++;
            } else {
                console.log(`   ❌ FAIL: ${verifyResult.reason}`);
                failed++;
            }
        } catch (error) {
            console.log(`   ❌ ERROR: ${error.message}`);
            failed++;
        }
        console.log('─'.repeat(50));
    }

    console.log(`\nFinal Score: ${passed}/${tests.length}`);
    if (failed === 0) {
        console.log('🎊 ALL Batch 2 tests passed!');
    } else {
        console.log(`⚠️  ${failed} test(s) failed.`);
    }
    process.exit(failed > 0 ? 1 : 0);
}

runTests();
