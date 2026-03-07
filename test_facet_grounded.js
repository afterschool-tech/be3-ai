/**
 * COMPREHENSIVE GROUNDED FACET_LIST E2E TEST (FULL PIPELINE)
 * ============================================================
 * 
 * This test simulates the ENTIRE AI intent resolution pipeline
 * using the resolveAndMap() entry point. It also simulates
 * the backend tool execution by filtering real_products.json,
 * with proper SCOPING by category and product query.
 * 
 * Run: node test_facet_grounded.js
 */

const fs = require('fs');
const path = require('path');

// --- PIPELINE IMPORTS ---
const { resolveAndMap } = require('./src/services/intentResolver/index');
const { ATTRIBUTES, CATEGORIES } = require('./src/context/storeContext');

// --- SETUP ---
const SEP = '='.repeat(80);
const DATA_PATH = path.join(__dirname, 'real_products.json');
let realData = { products: [], facets: [] };

try {
    const raw = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
    if (Array.isArray(raw)) {
        realData.products = raw;
    } else if (raw.products) {
        realData = raw;
    } else {
        realData.products = raw;
    }
} catch (e) {
    console.error(`🔴 Critical Error: Could not load ${DATA_PATH}:`, e.message);
    process.exit(1);
}

// Silence noisy pipeline logs for a clean report
const origLog = console.log;
console.log = () => { };
console.warn = () => { };
console.error = () => { };

// Mock storeContext
const mockStoreContext = {
    TENANT_ID: 'test-tenant',
    ATTRIBUTES: ATTRIBUTES,
    CATEGORIES: CATEGORIES
};

// Fresh mock state per test to prevent leakage
function createFreshState() {
    return {
        user_id: 'test-user-' + Date.now(),
        product_context: {
            last_search: { results: [], filters: {} }
        },
        reference_map: {},
        search_context: {
            product_attributes_map: {}
        }
    };
}

// Mock AI query function
const mockAiQueryFn = async (prompt) => {
    return { parameters: {} };
};

/**
 * Resolve plural/variation attribute name to canonical code
 * (mirrors the logic in product.facets handler)
 */
function resolveAttrCode(rawTarget) {
    if (!rawTarget) return rawTarget;
    let code = rawTarget.toLowerCase().trim();
    if (ATTRIBUTES[code]) return code;
    const singular = code.replace(/s$/, '');
    if (ATTRIBUTES[singular]) return singular;
    for (const [k, attr] of Object.entries(ATTRIBUTES)) {
        if (attr.label?.toLowerCase() === code || attr.label?.toLowerCase() === singular) return k;
    }
    return code;
}

const testCases = [
    // ══════════════════════════════════════════════════════════════════
    // FACET_LIST: Queries asking WHAT OPTIONS EXIST for an attribute
    // ══════════════════════════════════════════════════════════════════

    // ── BRAND ─────────────────────────────────────────────────────
    { q: "which phone brands do you sell?", expected: "facet_list" },
    { q: "what brands of tablets are available?", expected: "facet_list" },
    { q: "what phone brands do you carry?", expected: "facet_list" },

    // ── COLOR ─────────────────────────────────────────────────────
    { q: "what colors does the Nice Watch come in?", expected: "facet_list" },
    { q: "do you have phones in different colors?", expected: "facet_list" },
    { q: "what color options are there for watches?", expected: "facet_list" },
    { q: "what colors are available for iphones?", expected: "facet_list" },

    // ── MATERIAL ──────────────────────────────────────────────────
    { q: "what materials are the laptops made of?", expected: "facet_list" },
    { q: "what materials do your products come in?", expected: "facet_list" },

    // ── QUALITY ───────────────────────────────────────────────────
    { q: "what condition are the phones in?", expected: "facet_list" },
    { q: "what qualities of products do you have?", expected: "facet_list" },

    // ── SIZE ──────────────────────────────────────────────────────
    { q: "what sizes do the phones come in?", expected: "facet_list" },
    { q: "what sizes are available for electronics?", expected: "facet_list" },

    // ── STORAGE ──────────────────────────────────────────────────
    { q: "what storage options do you have for phones?", expected: "facet_list" },

    // ══════════════════════════════════════════════════════════════════
    // NEGATIVE CASES
    // ══════════════════════════════════════════════════════════════════
    { q: "i want to buy the infinix hot 60 pro", expected: "product_search" },
    { q: "show me all samsung phones", expected: "product_search" },
    { q: "add the black samsung tablet to my cart", expected: ["add_to_cart", "product_search"] },
    { q: "do you have budget phones?", expected: "product_search" },
    { q: "show me premium tablets", expected: "product_search" },
    { q: "what infinix phones do you have?", expected: "product_search" },
    { q: "do you carry any apple products?", expected: "product_search" },
];

/**
 * Result Simulator: Simulates the backend /search facet aggregation using local JSON data.
 * Now supports SCOPING by category and product query.
 */
function simulateToolExecution(toolCall) {
    if (!toolCall) return null;
    const { tool, params } = toolCall;

    if (tool === 'product.facets') {
        const rawTarget = params.facet_target;
        const categoryFilter = params.category;
        const queryFilter = params.query;
        const vendorFilter = params.vendor;

        // 1. Resolve attribute code
        const canonicalCode = resolveAttrCode(rawTarget);
        const attrDef = ATTRIBUTES[canonicalCode];
        const attrCode = attrDef ? attrDef.code : canonicalCode;
        const attrLabel = attrDef ? attrDef.label : canonicalCode;

        // 2. Filter products based on scope
        let filtered = realData.products || [];

        // Category scoping — products now have category_ids: [uuid, ...]
        if (categoryFilter) {
            const catObj = Object.values(CATEGORIES || {}).find(
                c => c.id === categoryFilter || c.slug === categoryFilter
            );
            if (catObj) {
                filtered = filtered.filter(p =>
                    (Array.isArray(p.category_ids) && (p.category_ids.includes(catObj.id) || p.category_ids.includes(catObj.slug)))
                );
            }
        }

        // Product query scoping
        if (queryFilter) {
            const q = queryFilter.toLowerCase();
            filtered = filtered.filter(p =>
                p.name.toLowerCase().includes(q) ||
                (p.tags && p.tags.toLowerCase().includes(q))
            );
        }

        // Vendor scoping
        if (vendorFilter) {
            filtered = filtered.filter(p =>
                p.vendor && p.vendor.toLowerCase() === vendorFilter.toLowerCase()
            );
        }

        // 3. Aggregate values with counts (mimics FacetedFiltersAggregator)
        const valueCounts = {};
        filtered.forEach(p => {
            if (!p.attrs) return;
            const val = p.attrs[canonicalCode] || p.attrs[attrCode];
            if (val) {
                valueCounts[val] = (valueCounts[val] || 0) + 1;
            }
        });

        const options = Object.entries(valueCounts)
            .map(([value, count]) => ({ value, count }))
            .sort((a, b) => b.count - a.count);

        // 4. Determine scope
        let scope = 'global';
        let scopeLabel = null;
        if (categoryFilter) {
            scope = 'category';
            const catObj = Object.values(CATEGORIES || {}).find(
                c => c.id === categoryFilter || c.slug === categoryFilter
            );
            scopeLabel = catObj ? catObj.label : categoryFilter;
        } else if (queryFilter) {
            scope = 'query';
            scopeLabel = queryFilter;
        }

        // 5. Also check predefined values from ATTRIBUTES
        const predefined = attrDef && attrDef.predefined_values
            ? attrDef.predefined_values.map(pv => pv.label || pv.value || pv)
            : [];

        return {
            targetAttribute: canonicalCode,
            label: attrLabel,
            options,
            globalPredefined: predefined,
            matchCount: filtered.length,
            scope,
            scopeLabel,
            sampleItems: filtered.slice(0, 3).map(p =>
                `${p.name} (${p.attrs?.[canonicalCode] || p.attrs?.[attrCode] || 'N/A'})`
            )
        };
    }

    return null;
}

async function runTests() {
    origLog(`\n${SEP}`);
    origLog(`  COMPREHENSIVE GROUNDED E2E TEST (FULL PIPELINE)`);
    origLog(`  Simulating intent resolution + scoped tool execution`);
    origLog(`  Products loaded: ${(realData.products || []).length}`);
    origLog(SEP);

    let passedCount = 0;
    const allResults = [];

    for (const tc of testCases) {
        const state = createFreshState();
        const result = await resolveAndMap(tc.q, state, mockAiQueryFn, mockStoreContext);

        const winner = result.intents && result.intents[0] ? result.intents[0] : null;
        const gotIntent = winner ? winner.intentName : (result.tools && result.tools[0] ? result.tools[0].reason : 'none');

        const pass = Array.isArray(tc.expected)
            ? tc.expected.includes(gotIntent)
            : gotIntent === tc.expected;
        if (pass) passedCount++;

        // Simulate tool execution for facet_list
        let toolSim = null;
        if (gotIntent === 'facet_list' || (result.tools && result.tools[0] && result.tools[0].tool === 'product.facets')) {
            toolSim = simulateToolExecution(result.tools[0]);
        }

        // Extract top candidates
        const candidates = (winner && winner.candidates)
            ? winner.candidates.slice(0, 5)
            : (result.statementResolutions && result.statementResolutions[0] && result.statementResolutions[0].candidates)
                ? result.statementResolutions[0].candidates.slice(0, 5)
                : [];

        const report = {
            q: tc.q,
            expected: tc.expected,
            got: gotIntent,
            pass,
            params: winner ? winner.parameters : (result.tools && result.tools[0] ? result.tools[0].params : {}),
            tool: result.tools && result.tools[0] ? result.tools[0].tool : 'none',
            sim: toolSim,
            top5: candidates.map(c => `${c.intentName}:${c.score.toFixed(1)}`).join(', ') || 'none'
        };
        allResults.push(report);

        // Print individual logs
        const icon = pass ? '✅' : '❌';
        origLog(`\n${icon} [${pass ? 'PASS' : 'FAIL'}] "${tc.q}"`);
        origLog(`   Intent:     ${gotIntent} (Expected: ${tc.expected})`);
        origLog(`   Candidates: ${report.top5}`);
        origLog(`   Tool:       ${report.tool}`);
        origLog(`   Params:     ${JSON.stringify(report.params)}`);

        if (toolSim) {
            origLog(`   ── Scoped Facet Simulation ──`);
            origLog(`   Attribute:  ${toolSim.label} (code: ${toolSim.targetAttribute})`);
            origLog(`   Scope:      ${toolSim.scope}${toolSim.scopeLabel ? ' → ' + toolSim.scopeLabel : ''}`);
            origLog(`   Values:     ${toolSim.options.length > 0
                ? toolSim.options.map(o => `${o.value} (${o.count})`).join(', ')
                : '⚠️ No values found in this scope'
                }`);
            if (toolSim.globalPredefined.length > 0) {
                origLog(`   Predefined: ${toolSim.globalPredefined.join(', ')}`);
            }
            origLog(`   Matched:    ${toolSim.matchCount} products in scope`);
            if (toolSim.sampleItems.length > 0) {
                origLog(`   Samples:    ${toolSim.sampleItems.join(', ')}`);
            }
        }
    }

    origLog(`\n${SEP}`);
    origLog(`  FINAL SCORE: ${passedCount}/${testCases.length} Passed`);
    origLog(SEP);

    fs.writeFileSync('facet_grounded_results.json', JSON.stringify(allResults, null, 2));
    origLog(`\nDetailed results saved to facet_grounded_results.json\n`);
}

runTests().catch(err => {
    origLog(`\n🔴 Test Runner Crash:`, err);
});
