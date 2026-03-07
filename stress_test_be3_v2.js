const { resolveDeterministic } = require('./src/core/deterministicResolver');
const { ATTRIBUTES, CATEGORIES, VENDORS } = require('./src/context/storeContext');
const fs = require('fs');

const realData = JSON.parse(fs.readFileSync('real_products.json', 'utf8'));

const testCases = [
    // 1. Search vs Facet (Structural: Search Verb vs Discovery Verb)
    {
        q: "show me brown watches",
        expectedIntent: "product_search",
        expectedParams: { category: "watches", attributes: { "c:c": "black,brown" } }
    },
    {
        q: "what colors are available for watches?",
        expectedIntent: "facet_list",
        expectedParams: { facet_target: "colors", category: "watches" }
    },

    // 2. Exact Product Search vs Add To Cart
    {
        q: "find the infinix hot 60 pro",
        expectedIntent: "product_search",
        expectedParams: { query: "infinix hot 60 pro", category: "smartphones" }
    },
    {
        q: "add the infinix hot 60 pro to my cart",
        expectedIntent: "add_to_cart",
        expectedParams: { product_name: "Infinix Hot 60 pro" }
    },

    // 3. Vendor Logic: Search by Vendor vs Vendor Information
    {
        q: "search for spaghetti by bola foods",
        expectedIntent: "product_search",
        expectedParams: { query: "spaghetti", vendor: "Bola Foods" }
    },
    {
        q: "who is bola foods?",
        expectedIntent: "vendor_info",
        expectedParams: { vendor_name: "Bola Foods" }
    },

    // 4. Comparison vs Multi-Brand Search
    {
        q: "compare the infinix hot 60 and tecno spark 40",
        expectedIntent: "product_compare",
        expectedParams: { products: ["Infinix Hot 60 pro", "Tecno Spark 40 pro"] }
    },
    {
        q: "show me infinix and tecno smart phones",
        expectedIntent: "product_search",
        expectedParams: { category: "smartphones", attributes: { "b": "infinix,tecno" } }
    },

    // 5. Attribute Specificity
    {
        q: "phones with high quality",
        expectedIntent: "product_search",
        expectedParams: { category: "smartphones", attributes: { "q:t": "Grade A" } }
    },
    {
        q: "what quality options do you have for phones?",
        expectedIntent: "facet_list",
        expectedParams: { facet_target: "quality", category: "smartphones" }
    },

    // 6. Service / Navigation
    {
        q: "where is my order 5521",
        expectedIntent: "order_status",
        expectedParams: { order_number: "5521" }
    },
    {
        q: "show my previous orders",
        expectedIntent: "list_orders"
    },
    {
        q: "show my bag",
        expectedIntent: "view_cart"
    }
];

async function runStressTest() {
    console.log("====================================================");
    console.log("   BE3 AI STRESS TEST V2.1 - GROUNDED AMBIGUITY");
    console.log("====================================================\n");

    let passed = 0;

    for (const test of testCases) {
        console.log(`Query: "${test.q}"`);
        try {
            const state = {
                user_id: 'test-user',
                session_id: 'test-session',
                conversation_history: [],
                reference_map: {}
            };
            const output = await resolveDeterministic(test.q, state);
            const intent = output.intent;
            const params = output.tools[0]?.params || {};

            let intentOk = intent === test.expectedIntent;
            let paramsOk = true;

            if (test.expectedParams) {
                for (const [key, val] of Object.entries(test.expectedParams)) {
                    const actualVal = params[key];

                    if (Array.isArray(val)) {
                        // Handle product name arrays for comparison
                        if (!Array.isArray(actualVal) || val.length !== actualVal.length) {
                            paramsOk = false;
                        } else {
                            const sortedVal = [...val].sort();
                            const sortedActual = [...actualVal].sort();
                            if (JSON.stringify(sortedVal).toLowerCase() !== JSON.stringify(sortedActual).toLowerCase()) {
                                paramsOk = false;
                            }
                        }
                    } else if (typeof val === 'object' && val !== null) {
                        // Handle nested attributes
                        if (JSON.stringify(actualVal) !== JSON.stringify(val)) {
                            paramsOk = false;
                        }
                    } else {
                        // Scalar match with UUID/slug fallback
                        if (actualVal !== val) {
                            if (key === 'category' || key === 'vendor') {
                                const cat = Object.values(CATEGORIES).find(c => c.slug === val || c.id === val || c.label.toLowerCase() === String(val).toLowerCase());
                                if (cat && (actualVal === cat.id || actualVal === cat.slug)) continue;
                            }
                            paramsOk = false;
                        }
                    }
                }
            }

            console.log(`  Intent:   ${intent} ${intentOk ? '✅' : '❌'}${!intentOk ? ` (Expected: ${test.expectedIntent})` : ''}`);

            if (test.expectedParams) {
                console.log(`  Params:   ${JSON.stringify(params)} ${paramsOk ? '✅' : '❌'}${!paramsOk ? ` (Expected keys: ${Object.keys(test.expectedParams).join(', ')})` : ''}`);
            }

            if (intentOk && paramsOk) passed++;

            // Grounding check for search / facet
            if (intent === 'product_search' || intent === 'facet_list') {
                const count = simulateGrounding(intent, params);
                console.log(`  Ground:   ${count > 0 ? `FOUND ${count} items ✅` : 'NO DATA FOUND ❌'}`);
            }

        } catch (err) {
            console.log(`  ERROR:    ${err.message}`);
            console.error(err);
        }
        console.log("");
    }

    console.log(`FINAL SCORE: ${passed}/${testCases.length} Passed`);
}

function simulateGrounding(intent, params) {
    let filtered = realData.products || [];

    // Category filter
    if (params.category) {
        const cat = Object.values(CATEGORIES).find(c => c.slug === params.category || c.id === params.category);
        if (cat) filtered = filtered.filter(p => p.category_ids.includes(cat.id));
        else return 0;
    }

    // Vendor filter
    if (params.tag || params.vendor || params.vendor_name) {
        let v = (params.tag || params.vendor || params.vendor_name).toLowerCase();
        filtered = filtered.filter(p => (p.vendor && p.vendor.toLowerCase().includes(v)) || (p.tags && p.tags.toLowerCase().includes(v)));
    }

    // Query filter
    let queryVal = params.query || params.product_query || params.q || params.product_name;
    if (queryVal && queryVal !== 'everything') {
        const q = String(Array.isArray(queryVal) ? queryVal.join(' ') : queryVal).toLowerCase();
        filtered = filtered.filter(p => p.name.toLowerCase().includes(q));
    }

    // Attribute filter
    if (params.attributes) {
        for (const [key, val] of Object.entries(params.attributes)) {
            if (typeof val === 'string') {
                const allowedVals = val.split(',').map(v => v.trim().toLowerCase());
                filtered = filtered.filter(p => {
                    const searchStr = `${p.tags || ''} ${p.name || ''} ${JSON.stringify(p.attrs || {})}`.toLowerCase();
                    return allowedVals.some(v => searchStr.includes(v));
                });
            }
        }
    }

    return filtered.length;
}

runStressTest().catch(console.error);
