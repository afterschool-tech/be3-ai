/**
 * Step 10: Final Suite Verification (Structural Extraction Layer)
 * 
 * This simulation verifies that the Structural Extraction Layer (Stage 5a) 
 * correctly extracts parameters across all critical intents with high precision.
 * 
 * DESIGN RULES:
 * 1. Brands (like Apple) are ATTRIBUTE values, matched via Clauses.
 * 2. Vendors (like Bola Foods) are STORE TENANTS, present in storeContext.VENDORS.
 */

const { resolveAndMap } = require('../src/services/intentResolver');
const storeContext = require('../src/context/storeContext');

const simulationCases = [
    // --- Product Search ---
    {
        name: 'Search: Cheap phones',
        text: 'show me cheap phones',
        expect: {
            intent: 'product_search',
            params: { product_name: 'phones', category: '5cba5153-0772-450a-b8b7-8a4fa532ecc1' } // matched android_phones
        }
    },
    {
        name: 'Search: Specific product with clause',
        text: 'i want affordable iphone 13',
        expect: {
            intent: 'product_search',
            params: {
                product_name: 'iphone 13',
                attributes: { "price tier": "affordable" }
            }
        }
    },

    // --- Brand vs. Vendor Distinction ---
    {
        name: 'Search: With Brand Clause (Apple)',
        text: 'find headphones from apple',
        expect: {
            intent: 'product_search',
            params: {
                product_name: 'headphones',
                attributes: { brand: 'apple' }
            }
        }
    },
    {
        name: 'Vendor: Official Tenant lookup (Bola Foods)',
        text: 'show me stuff from bola foods',
        expect: {
            intent: 'vendor_products',
            params: { vendor: 'bb039752-7b82-45ab-a512-5872f2fcda38' } // Bola Foods ID
        }
    },

    // --- Add to Cart ---
    {
        name: 'Cart: Quantity extraction',
        text: 'add 3 bottles of water to cart',
        expect: {
            intent: 'add_to_cart',
            params: { product_name: 'bottles of water', quantity: 3 }
        }
    },

    // --- Product Comparison ---
    {
        name: 'Compare: Two multi-word products',
        text: 'comparison between the macbook air m2 and surface laptop 5',
        expect: {
            intent: 'product_compare',
            params: { products: ['macbook air m2', 'surface laptop 5'] }
        }
    },

    // --- Check Availability ---
    {
        name: 'Availability: Clause + Product',
        text: 'is the blue laptop available?',
        expect: {
            intent: 'check_availability',
            params: { product_name: 'laptop', clause_words: [{ word: 'blue', clauseId: 'color_for_ladies' }] }
        }
    }
];

const mockState = {
    history: [],
    currently_viewing: null,
    product_context: {},
    cart: []
};

async function runSimulation() {
    console.log('=== PHASE 18: STRUCTURAL EXTRACTION FINAL VERIFICATION ===\n');

    let passed = 0;
    let failed = 0;

    for (const tc of simulationCases) {
        process.stdout.write(`Testing: ${tc.name}... `);

        try {
            // No AI fallback
            const result = await resolveAndMap(tc.text, mockState, null, storeContext);
            const winner = result.intents[0];

            if (!winner) {
                console.log('❌ FAILED (No intent resolved)');
                failed++;
                continue;
            }

            let ok = true;
            let failureMsg = '';

            // Check intent
            if (winner.intentName !== tc.expect.intent) {
                ok = false;
                failureMsg += `Expected intent ${tc.expect.intent}, got ${winner.intentName}. `;
            }

            // Check params
            for (const [key, value] of Object.entries(tc.expect.params)) {
                const actual = winner.parameters[key];

                if (key === 'clause_words') {
                    if (!actual || actual[0].word !== value[0].word) {
                        ok = false;
                        failureMsg += `Param ${key}: Expected ${JSON.stringify(value)}, got ${JSON.stringify(actual)}. `;
                    }
                } else if (key === 'products') {
                    if (!actual || actual.length !== value.length || (value.length > 1 && actual[1] !== value[1])) {
                        ok = false;
                        failureMsg += `Param ${key}: Expected ${JSON.stringify(value)}, got ${JSON.stringify(actual)}. `;
                    }
                } else if (key === 'attributes') {
                    if (!actual || JSON.stringify(actual) !== JSON.stringify(value)) {
                        ok = false;
                        failureMsg += `Param ${key}: Expected ${JSON.stringify(value)}, got ${JSON.stringify(actual)}. `;
                    }
                } else {
                    if (actual !== value) {
                        ok = false;
                        failureMsg += `Param ${key}: Expected ${value}, got ${actual}. `;
                    }
                }
            }

            if (ok) {
                console.log('✅');
                passed++;
            } else {
                console.log('❌');
                console.log(`   Input:    "${tc.text}"`);
                console.log(`   Result:   ${JSON.stringify({ intent: winner.intentName, params: winner.parameters }, null, 2)}`);
                console.log(`   Expected: ${JSON.stringify(tc.expect, null, 2)}`);
                if (failureMsg) console.log(`   Reason:   ${failureMsg}`);
                failed++;
            }

        } catch (err) {
            console.log(`💥 EXCEPTION: ${err.message}`);
            console.error(err);
            failed++;
        }
    }

    console.log(`\nResults: ${passed} passed, ${failed} failed out of ${simulationCases.length}`);

    if (failed === 0) {
        console.log('\n✨ ALL STRUCTURAL EXTRACTION TESTS PASSED! ✨');
    }
}

runSimulation();
