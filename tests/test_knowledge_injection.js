/**
 * Verification Suite for Phase 2: Knowledge Injection & Discovery Context
 */

const { resolveAndMap } = require('../src/services/intentResolver/index');
const { CATEGORIES, VENDORS, ATTRIBUTES } = require('../src/context/storeContext');
const { CLAUSES } = require('../src/context/clauses');

const storeContext = { CATEGORIES, VENDORS, ATTRIBUTES };
const IPHONE_CAT_ID = '9407551c-0204-4ffb-a054-1709177ebafc';
const FOOD_CAT_ID = '9569c36b-343d-47b2-9aac-1f2046c82b0e';

// Mock AI query function
const aiQueryFn = async (prompt) => {
    return "{}";
};

async function runTests() {
    console.log('🚀 Starting Knowledge Injection Verification...\n');

    const tests = [
        {
            name: 'Fuzzy Anchor: Vendor protection (Taye)',
            message: "Taye's",
            state: { user_id: 'ki_test_1' },
            verify: (result) => {
                const fuzzyCorrected = result.corrections.afterFuzzy;
                const hasTaye = fuzzyCorrected.toLowerCase().includes("taye");
                if (!hasTaye) console.log(`      Mismatch: afterFuzzy="${fuzzyCorrected}"`);
                return hasTaye;
            }
        },
        {
            name: 'Context Reconciler: Generic Search (No override)',
            message: 'show me iphones',
            state: {
                user_id: 'ki_test_2',
                product_context: {
                    last_search: {
                        query: 'phones',
                        results: [{ id: 'p1', category_id: IPHONE_CAT_ID }]
                    }
                }
            },
            verify: (result) => {
                const intent = result.intents[0];
                return intent.intentName === 'product_search' &&
                    intent.parameters.category === IPHONE_CAT_ID &&
                    !intent.reconciledFromContext;
            }
        },
        {
            name: 'Context Reconciler: Add to Cart Override',
            message: 'add iphones to cart',
            state: {
                user_id: 'ki_test_3',
                product_context: {
                    last_search: {
                        query: 'phones',
                        results: [{ id: 'iphone_16_pro', category_id: IPHONE_CAT_ID }]
                    }
                }
            },
            verify: (result) => {
                const intent = result.intents[0];
                const matched = intent.intentName === 'add_to_cart' &&
                    intent.parameters.product_id === 'iphone_16_pro' &&
                    intent.reconciledFromContext === true;
                if (!matched) console.log(`      Mismatch: productId="${intent.parameters.product_id}", reconciled=${intent.reconciledFromContext}`);
                return matched;
            }
        },
        {
            name: 'Attribute Scoping: Supported Attribute (Color for iPhones)',
            message: 'red iphones',
            state: { user_id: 'ki_test_4' },
            verify: (result) => {
                const params = result.intents[0].parameters;
                const hasColor = (params.clause_words?.length > 0) || (params.attributes && params.attributes.color);
                if (!hasColor) console.log(`      Mismatch: No color clause. Params:`, JSON.stringify(params, null, 2));
                return params.category === IPHONE_CAT_ID && hasColor;
            }
        },
        {
            name: 'Attribute Scoping: Restricted Attribute (Material Noise)',
            message: 'apple food',
            state: { user_id: 'ki_test_5' },
            verify: (result) => {
                const intent = result.intents[0];
                const params = intent.parameters;
                const brandLeaked = !!(params.brand || (params.attributes && params.attributes.brand));
                if (brandLeaked) {
                    console.log(`      Mismatch: Brand leaked! Params:`, JSON.stringify(params, null, 2));
                    console.log(`      Entities from Stage 4:`, JSON.stringify(result.intents[0].extractedParams, null, 2));
                }
                return params.category === FOOD_CAT_ID && !brandLeaked;
            }
        }
    ];

    let passed = 0;
    for (const test of tests) {
        console.log(`Testing: ${test.name}`);
        try {
            const result = await resolveAndMap(test.message, test.state, aiQueryFn, storeContext);
            if (test.verify(result)) {
                console.log('   ✅ PASS');
                passed++;
            } else {
                console.log('   ❌ FAIL');
                // Removed the silent params print as verify() now prints specifics
            }
        } catch (e) {
            console.log('   💥 CRASH');
            console.error(e);
        }
        console.log('--------------------------------------------------');
    }

    console.log(`\nFinal Score: ${passed}/${tests.length}`);
    if (passed === tests.length) {
        console.log('🎊 ALL Knowledge Injection tests passed!');
        process.exit(0);
    } else {
        process.exit(1);
    }
}

runTests();
