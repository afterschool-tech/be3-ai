#!/usr/bin/env node
/**
 * transformer_pos_test.js
 * 
 * Tests the POS gating logic on transformer-injected entities.
 */

const { tagWords } = require('./src/services/intentResolver/pipeline/posAnalyzer');
const { resolveClausesGlobal } = require('./src/utils/semanticClauseResolver');
const { extractEntities } = require('./src/services/intentResolver/pipeline/entityExtractor');

const C = { reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m', bold: '\x1b[1m' };

let passed = 0; let failed = 0;
function assert(name, condition) {
    if (condition) { passed++; console.log(`  ${C.green}✓${C.reset} ${name}`); } 
    else { failed++; console.log(`  ${C.red}✗${C.reset} ${name}`); }
}
function section(title) { console.log(`\n${C.bold}━━━ ${title} ━━━${C.reset}`); }

console.log(`${C.bold}Testing Transformer POS Gating...${C.reset}`);

// Simulated store context
const storeContext = {
    CATEGORIES: {
        'cat1': { id: 'cat1', label: 'Smartphones', slug: 'smartphones' }
    },
    VENDORS: {
        'v1': { id: 'v1', business_name: 'Apple', tag: 'apple' }
    }
};

const text = "going for apple and quickly storage";
const words = text.split(/\s+/);
const posTagMap = tagWords(text);

// Helper function to reshape (mimics index.js)
function reshapeExtractEntities(rawResult) {
    if (!rawResult) return null;
    const entities = rawResult.entities || {};
    const confidence = rawResult.confidence || {};
    const shaped = {};
    if (entities.clause && !Array.isArray(entities.clause)) {
        shaped.clause = Object.entries(entities.clause).flatMap(([key, words]) => 
            words.map(mw => ({ key, matchedWord: mw, score: 0.9 }))
        );
    }
    if (entities.category && !Array.isArray(entities.category)) {
        shaped.category = Object.entries(entities.category).flatMap(([key, words]) => 
            words.map(mw => ({ key, matchedWord: mw, score: 0.9 }))
        );
    }
    if (entities.vendor && !Array.isArray(entities.vendor)) {
        shaped.vendor = Object.entries(entities.vendor).flatMap(([key, words]) => 
            words.map(mw => ({ key, matchedWord: mw, score: 0.9 }))
        );
    }
    if (entities.attribute) {
        shaped.attribute = {};
        for (const [k, v] of Object.entries(entities.attribute)) {
            shaped.attribute[k] = v.map(val => ({ value: val, score: 0.9 }));
        }
    }
    return shaped;
}

// ── MOCK TRANSFORMER PAYLOAD ──
const rawResult = {
    entities: {
        category: {
            "cat1": ["going"] // "going" is Verb -> should be blocked
        },
        clause: {
            "affordable_price": ["going"] // Verb -> should be blocked
        },
        vendor: {
            "v1": ["quickly"] // "quickly" is Adverb -> should be blocked for vendor v1 (Apple)
        },
        attribute: {
            "color": ["going"] // Verb -> should be blocked
        }
    }
};

const shapedEntities = reshapeExtractEntities(rawResult);
const semanticContextForPrepass = { entities: shapedEntities, available: true };

// ── TEST 1: PREPASS ──
section('1. Transformer Prepass (resolveClausesGlobal)');
const prepassResult = resolveClausesGlobal(text, [], semanticContextForPrepass, posTagMap);

const clauseIds = prepassResult.globalEntities.map(e => e.clauseId);
assert('Verb clause "affordable_price" ("going") is blocked', !clauseIds.includes('affordable_price'));

const catHints = prepassResult.categoryHints;
assert('Verb category hint "cat1" ("going") is blocked', !catHints.includes('cat1'));


// ── TEST 2: ENTITY EXTRACTOR ──
section('2. Entity Extraction (extractEntities)');
const semanticContextForExtractor = { ...rawResult, available: true };
const entityResult = extractEntities(
    text, 
    storeContext, 
    {}, 
    null, 
    [], 
    prepassResult.globalEntities, 
    prepassResult.categoryHints, 
    semanticContextForExtractor, 
    posTagMap
);

const vendorIds = entityResult.entities.filter(e => e.type === 'vendor').map(e => e.id);
assert('Adverb vendor match "v1" ("quickly") is blocked', !vendorIds.includes('v1'));

const attributes = entityResult.entities.filter(e => e.type === 'transformer_attribute_hint').map(e => e.value);
assert('Verb attribute hint "going" is blocked', !attributes.includes('going'));

// ── Summary ──
console.log(`\n${'-'.repeat(30)}`);
if (failed === 0) {
    console.log(`${C.green}All ${passed} POS gating tests passed ✓${C.reset}\n`);
} else {
    console.log(`${C.red}${failed} tests failed${C.reset} out of ${passed + failed}\n`);
    // Print entities to help debug
    console.log('Final Entities:', JSON.stringify(entityResult.entities, null, 2));
    process.exit(1);
}
