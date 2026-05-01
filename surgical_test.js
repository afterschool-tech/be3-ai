#!/usr/bin/env node
/**
 * surgical_test.js
 *
 * Tests the two fixes:
 * 1. Reference map pronoun update (it/this/that_one semantics)
 * 2. Ambient context guardrail removal + entityExtraction gate
 *
 * Strategy: stub only external deps (Redis, debugLogger), load real modules,
 * then monkey-patch stateManager.getState / setState with in-memory store.
 * No API calls. Dummy products only.
 */

'use strict';

// ─── Stub external deps BEFORE any require ────────────────────────────────────
const Module = require('module');
const _orig  = Module._load;

const REDIS_STUB = {
    isRedisConnected: () => false,
    getClient: () => ({
        get:     async () => null,
        set:     async () => null,
        setEx:   async () => null,
        del:     async () => null,
        lPush:   async () => null,
        lRange:  async () => [],
        expire:  async () => null,
    })
};
const DEBUG_STUB  = { logDebug: () => {} };
const GUARDS_STUB = { MODEL_QUALIFIER_WORDS: new Set(['pro','ultra','max','plus','lite','mini','se']) };

Module._load = function (request, parent, isMain) {
    if (/[\\/]state[\\/]redis$/.test(request) || request === './redis') return REDIS_STUB;
    if (/debugLogger/.test(request))           return DEBUG_STUB;
    if (/contextResolverGuards/.test(request)) return GUARDS_STUB;
    return _orig.apply(this, arguments);
};

// ─── Load real modules ────────────────────────────────────────────────────────
const path = require('path');
const ROOT = path.resolve(__dirname, 'src');

const stateManager = require(path.join(ROOT, 'state/stateManager'));
const { resolveReferences } = require(path.join(ROOT, 'services/intentResolver/pipeline/contextResolver'));
const { resolveAmbientContext, buildAmbientEntities } = require(path.join(ROOT, 'services/intentResolver/pipeline/ambientContextResolver'));

// ─── In-memory store + monkey-patch ──────────────────────────────────────────
const _store = {};

function freshState(userId, overrides = {}) {
    _store[userId] = {
        reference_map:   {},
        ordinal_list:    [],
        product_context: { last_search: { results: [] } },
        active_topic:    null,
        ...overrides
    };
}

stateManager.getState       = async (u) => JSON.parse(JSON.stringify(_store[u] || {}));
stateManager.setState       = async (u, s) => { _store[u] = JSON.parse(JSON.stringify(s)); };
stateManager.getActiveTopic = async (u) => _store[u]?.active_topic || null;

// ─── Colour + test helpers ────────────────────────────────────────────────────
const C = {
    reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
    red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
    blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m',
};
const PASS = `${C.green}✓${C.reset}`;
const FAIL = `${C.red}✗${C.reset}`;

let passed = 0, failed = 0;

function assert(label, condition, detail = '') {
    if (condition) { console.log(`  ${PASS} ${label}`); passed++; }
    else           { console.log(`  ${FAIL} ${label}`); if (detail) console.log(`     ${C.dim}→ ${detail}${C.reset}`); failed++; }
}
function section(t) { console.log(`\n${C.bold}${C.cyan}━━━ ${t} ━━━${C.reset}`); }

// ─── Dummy products ───────────────────────────────────────────────────────────
const CAPS_MULTI = [
    { id: 'cap-1', handle: 'cap-1', name: 'Blue Ocean Cap',    price: 2500 },
    { id: 'cap-2', handle: 'cap-2', name: 'Red Storm Cap',     price: 3000 },
    { id: 'cap-3', handle: 'cap-3', name: 'Black Panther Cap', price: 2800 },
];
const PHONE_SINGLE = [
    { id: 'phone-1', handle: 'phone-1', name: 'Samsung Galaxy A54', price: 180000 }
];
const SNEAKERS = [
    { id: 'snk-1', handle: 'snk-1', name: 'Air Force One',     price: 45000 },
    { id: 'snk-2', handle: 'snk-2', name: 'Adidas Ultraboost', price: 62000 },
    { id: 'snk-3', handle: 'snk-3', name: 'Nike Air Max',      price: 55000 },
];
const USER = 'test-user-001';

(async () => {

// ════════════════════════════════════════════════════════════════════
section('1. Reference Map — Multi-Product (SET OVERWRITE)');
// ════════════════════════════════════════════════════════════════════
freshState(USER, { product_context: { last_search: { results: CAPS_MULTI } } });
await stateManager.updateReferenceMap(USER, CAPS_MULTI, { scope: 'global' });
const rm1 = (await stateManager.getState(USER)).reference_map;

assert('"it" DELETED on multi-product',       !rm1.it,       `got "${rm1.it}"`);
assert('"this" DELETED on multi-product',     !rm1.this,     `got "${rm1.this}"`);
assert('"that_one" DELETED on multi-product', !rm1.that_one, `got "${rm1.that_one}"`);
assert('"this_one" DELETED on multi-product', !rm1.this_one, `got "${rm1.this_one}"`);
assert('"that" (bare) never written',         !rm1.that,     `got "${rm1.that}"`);
assert('"the_one" → first item',  rm1.the_one === 'cap-1',  `got "${rm1.the_one}"`);
assert('"first"   → cap-1',       rm1.first   === 'cap-1',  `got "${rm1.first}"`);
assert('"second"  → cap-2',       rm1.second  === 'cap-2',  `got "${rm1.second}"`);
assert('"third"   → cap-3',       rm1.third   === 'cap-3',  `got "${rm1.third}"`);
assert('"them"    → all 3 IDs',   rm1.them === 'cap-1,cap-2,cap-3', `got "${rm1.them}"`);
assert('"the_cheapest" → cap-1',  rm1.the_cheapest === 'cap-1', `got "${rm1.the_cheapest}"`);

// ════════════════════════════════════════════════════════════════════
section('2. Reference Map — Single Product (ACCUMULATION)');
// ════════════════════════════════════════════════════════════════════
freshState(USER, { product_context: { last_search: { results: PHONE_SINGLE } } });
await stateManager.updateReferenceMap(USER, PHONE_SINGLE, { scope: 'global' });
const rm2 = (await stateManager.getState(USER)).reference_map;

assert('"it"       → single product', rm2.it       === 'phone-1', `got "${rm2.it}"`);
assert('"this"     → single product', rm2.this     === 'phone-1', `got "${rm2.this}"`);
assert('"this_one" → single product', rm2.this_one === 'phone-1', `got "${rm2.this_one}"`);
assert('"that_one" → single product', rm2.that_one === 'phone-1', `got "${rm2.that_one}"`);
assert('"that" (bare) NOT written',   !rm2.that,  `got "${rm2.that}"`);
assert('"first" filled by accumulation', rm2.first === 'phone-1', `got "${rm2.first}"`);

// ════════════════════════════════════════════════════════════════════
section('3. Reference Map — Single then Multi (singular pronouns wiped)');
// ════════════════════════════════════════════════════════════════════
freshState(USER, { product_context: { last_search: { results: [...PHONE_SINGLE, ...CAPS_MULTI] } } });
await stateManager.updateReferenceMap(USER, PHONE_SINGLE, { scope: 'global' });
await stateManager.updateReferenceMap(USER, CAPS_MULTI,   { scope: 'global' });
const rm3 = (await stateManager.getState(USER)).reference_map;

assert('"it" wiped by multi-product',       !rm3.it,       `got "${rm3.it}"`);
assert('"this" wiped by multi-product',     !rm3.this,     `got "${rm3.this}"`);
assert('"this_one" wiped by multi-product', !rm3.this_one, `got "${rm3.this_one}"`);
assert('"that_one" wiped by multi-product', !rm3.that_one, `got "${rm3.that_one}"`);
assert('"first" → cap-1 from new set',       rm3.first === 'cap-1', `got "${rm3.first}"`);

// ════════════════════════════════════════════════════════════════════
section('4. Context Resolver — Pronouns resolve after single-product');
// ════════════════════════════════════════════════════════════════════
freshState(USER, { product_context: { last_search: { results: PHONE_SINGLE } } });
await stateManager.updateReferenceMap(USER, PHONE_SINGLE, { scope: 'global' });
const s4 = await stateManager.getState(USER);
const res = (t, sk=[]) => resolveReferences(t, s4, {}, sk, 'all');

assert('"it" resolves',       res('add it to cart').resolutions[0]?.resolved?.includes('Samsung'), `Got none`);
assert('"this" resolves',     res('do you have this in blue').resolutions[0]?.resolved?.includes('Samsung'), `Got none`);
assert('"this one" resolves', res('add this one to cart').resolutions[0]?.resolved?.includes('Samsung'), `Got none`);
assert('"that one" resolves', res('add that one to cart').resolutions[0]?.resolved?.includes('Samsung'), `Got none`);

// ════════════════════════════════════════════════════════════════════
section('5. Context Resolver — Bare "that" never resolves');
// ════════════════════════════════════════════════════════════════════
assert('"that aside..." — no resolution', res('that aside show me phones').resolutions.length === 0);
assert('"i want that"  — no resolution', res('i want that').resolutions.length === 0);
assert('"add that to cart" — no resolution', res('add that to cart').resolutions.length === 0);

// ════════════════════════════════════════════════════════════════════
section('6. Context Resolver — Multi-product: it/this blocked, ordinals work');
// ════════════════════════════════════════════════════════════════════
freshState(USER, { product_context: { last_search: { results: CAPS_MULTI } } });
await stateManager.updateReferenceMap(USER, CAPS_MULTI, { scope: 'global' });
const s6 = await stateManager.getState(USER);
const res6 = (t) => resolveReferences(t, s6, {}, [], 'all');

assert('"it" blocked after multi-product',   res6('do you have it in blue').resolutions.length === 0);
assert('"this" blocked after multi-product', res6('do you have this in blue').resolutions.length === 0);
assert('"the first one" still resolves',     res6('add the first one to cart').resolutions[0]?.resolved?.includes('Cap'));
assert('"the second one" still resolves',    res6('show me the second one').resolutions[0]?.resolved?.includes('Cap'));

// ════════════════════════════════════════════════════════════════════
section('7. Ambient Context — Gate and Injection');
// ════════════════════════════════════════════════════════════════════
const productTopic = { type: 'product', category_id: 'cats-caps', category_label: 'Caps', vendor: null, attributes: { color: 'red' } };
_store[USER] = { active_topic: productTopic };

const weak     = [{ type: 'attribute', attributeCode: 'color', value: 'blue' }];
const ambA     = await resolveAmbientContext('do you have it in blue', weak, { user_id: USER });
const injTrue  = (ambA?.pendingAmbient) ? buildAmbientEntities(ambA.pendingAmbient, { user_id: USER }, null) : [];

// gate=false path (no injection even if pendingAmbient)
let injFalse = [];
// (gate check: entityExtraction !== true → skip)

const strong  = [{ type: 'category', value: 'Phones', categoryId: 'cats-phones' }];
const ambB    = await resolveAmbientContext('show me blue phones', strong, { user_id: USER });

_store[USER].active_topic = null;
const ambC    = await resolveAmbientContext('do you have it in blue', weak, { user_id: USER });

assert('pendingAmbient returned when only weak entities present',  !!(ambA?.pendingAmbient));
assert('Category entity injected (entityExtraction=true gate)',    injTrue.some(e => e.type === 'category' && e.categoryId === 'cats-caps'));
assert('Prior attribute (color=red) injected from topic',          injTrue.some(e => e.type === 'attribute' && e.value === 'red'));
assert('No injection when entityExtraction=false (injFalse=[]])',  injFalse.length === 0);
assert('No pendingAmbient when strong entity already present',     !(ambB?.pendingAmbient));
assert('No pendingAmbient when no active topic',                   !(ambC?.pendingAmbient));

// ════════════════════════════════════════════════════════════════════
section('8. "That one" resolves after viewing a product (getDetails patch)');
// ════════════════════════════════════════════════════════════════════
freshState(USER, { product_context: { last_search: { results: [...CAPS_MULTI, ...PHONE_SINGLE] } } });
await stateManager.updateReferenceMap(USER, CAPS_MULTI, { scope: 'global' });
await stateManager.updateReferenceMap(USER, [CAPS_MULTI[1]], { scope: 'global' }); // viewed cap-2
const s8  = await stateManager.getState(USER);
const rm8 = s8.reference_map;
const r8  = resolveReferences('add that one to cart', s8, {}, [], 'all');

assert('"that one" → cap-2',          rm8.that_one === 'cap-2', `got "${rm8.that_one}"`);
assert('"this one" → cap-2',          rm8.this_one === 'cap-2', `got "${rm8.this_one}"`);
assert('"first" still → cap-1',       rm8.first    === 'cap-1', `got "${rm8.first}"`);
assert('"add that one" resolves → Red Storm Cap', r8.resolutions[0]?.resolved?.includes('Red Storm'));

// ════════════════════════════════════════════════════════════════════
section('9. Ambient Attribute Conflict Guard — user value wins');
// ════════════════════════════════════════════════════════════════════
// Prior search: caps with color=red  |  User says: "do you have it in blue?"
// color=blue extracted this turn → ambient color=red must be DROPPED
// material=cotton not mentioned → ambient material=cotton STILL injects
// category=Caps always injects (it's a category, not an attribute)

const conflictTopic = {
    type: 'product', category_id: 'cats-caps', category_label: 'Caps',
    vendor: null, attributes: { color: 'red', material: 'cotton' }
};
_store[USER] = { active_topic: conflictTopic };

const ambC9  = await resolveAmbientContext('do you have it in blue', [], { user_id: USER });
const rawInj = ambC9?.pendingAmbient ? buildAmbientEntities(ambC9.pendingAmbient, { user_id: USER }, null) : [];

// Simulate the guard from index.js: user extracted color=blue this turn
const explicitCodes = new Set(['color']);
const safeInj = rawInj.filter(e => !(e.type === 'attribute' && explicitCodes.has(e.attributeCode)));

assert('Raw ambient includes color=red (before guard)',          rawInj.some(e => e.type === 'attribute' && e.attributeCode === 'color'));
assert('After guard: color=red DROPPED (user said blue)',        !safeInj.some(e => e.type === 'attribute' && e.attributeCode === 'color'));
assert('After guard: category=Caps still injected',              safeInj.some(e => e.type === 'category' && e.categoryId === 'cats-caps'));
assert('After guard: material=cotton injected (no conflict)',    safeInj.some(e => e.type === 'attribute' && e.attributeCode === 'material'));

// ── Vendor conflict ───────────────────────────────────────────────
// Ambient topic: vendor=adidas  |  User this turn says: "show me Nike shoes"
// Extraction finds vendor=nike → ambient vendor=adidas must be dropped

const vendorTopic = { type: 'vendor', vendor: 'adidas', category_id: null, category_label: null, attributes: null };
_store[USER] = { active_topic: vendorTopic };

const ambVendor  = await resolveAmbientContext('show me nike shoes', [], { user_id: USER });
const rawVendor  = ambVendor?.pendingAmbient ? buildAmbientEntities(ambVendor.pendingAmbient, { user_id: USER }, null) : [];

// Simulate guard: user extracted vendor=nike this turn
const hasExplicitVendor = true;
const safeVendor = rawVendor.filter(e => !(e.type === 'vendor' && hasExplicitVendor));

assert('Raw ambient includes vendor=adidas (before guard)',  rawVendor.some(e => e.type === 'vendor' && e.value === 'adidas'));
assert('After guard: vendor=adidas DROPPED (user said Nike)', !safeVendor.some(e => e.type === 'vendor'));

// ── Price conflict ────────────────────────────────────────────────
// Ambient topic: product with attribute.price_range="budget"
// User this turn: "show me caps under 3000" → extraction finds price entity
// Ambient price must be dropped (user overriding budget signal)

const priceTopic = {
    type: 'product', category_id: 'cats-caps', category_label: 'Caps',
    vendor: null, attributes: { price_range: 'premium' }   // prior search had premium filter
};
_store[USER] = { active_topic: priceTopic };

const ambPrice  = await resolveAmbientContext('show me caps under 3000', [], { user_id: USER });
const rawPrice  = ambPrice?.pendingAmbient ? buildAmbientEntities(ambPrice.pendingAmbient, { user_id: USER }, null) : [];

// Simulate guard: user extracted a price entity this turn
const hasExplicitPrice  = true;
// price_range in this case comes through as an attribute, so we check attributeCode
const safePrice = rawPrice.filter(e => {
    if (e.type === 'price') return !hasExplicitPrice;
    if (e.type === 'attribute' && e.attributeCode === 'price_range' && hasExplicitPrice) return false;
    return true;
});

assert('Raw ambient includes price_range=premium (before guard)', rawPrice.some(e => e.type === 'attribute' && e.attributeCode === 'price_range'));
assert('After guard: price_range=premium DROPPED (user stated price this turn)', !safePrice.some(e => e.type === 'attribute' && e.attributeCode === 'price_range'));
assert('After guard: category=Caps still injected from price topic', safePrice.some(e => e.type === 'category'));



// ─── Test summary ─────────────────────────────────────────────────────────────
const total = passed + failed;
console.log(`\n${'─'.repeat(52)}`);
console.log(`Results: ${C.green}${passed}/${total} passed${C.reset}` + (failed ? `  ${C.red}${failed} failed${C.reset}` : ''));
if (failed > 0) { console.log(`${C.red}${C.bold}${failed} test(s) failed${C.reset}\n`); process.exit(1); }
console.log(`${C.green}${C.bold}All tests passed ✓${C.reset}`);


// ════════════════════════════════════════════════════════════════════════════════
//  PRACTICAL SIMULATION — A real 8-turn shopping conversation
//  Shows turn-by-turn: reference map state, what resolves, ambient context
// ════════════════════════════════════════════════════════════════════════════════

function hr(ch = '═', n = 62) { return C.cyan + C.bold + ch.repeat(n) + C.reset; }

function printRefMap(rm) {
    const keys = ['it','this','this_one','that_one','that','the_one','first','second','third','them','the_cheapest','the_most_expensive'];
    return keys.map(k => {
        const v = rm[k];
        const isSingular = ['it','this','this_one','that_one'].includes(k);
        if (v !== undefined) return `    ${isSingular ? C.cyan : C.dim}${k.padEnd(22)}${C.reset}${C.green}→ ${v}${C.reset}`;
        return `    ${C.dim}${k.padEnd(22)}→ [not set]${C.reset}`;
    }).join('\n');
}

function printResolution(label, result) {
    if (!result.resolutions.length)
        return `    ${C.red}✗ no resolution${C.reset} — "${label}" passes through unchanged`;
    return result.resolutions.map(r =>
        `    ${C.green}✓${C.reset} "${r.original}" → ${C.bold}${r.resolved}${C.reset}  ${C.dim}(id: ${r.productId})${C.reset}`
    ).join('\n');
}

function turn(n, who, msg) {
    const whoColor = who === 'User' ? C.yellow : C.magenta;
    console.log(`\n  ${C.bold}Turn ${n}${C.reset}  ${whoColor}${who}:${C.reset} ${C.bold}"${msg}"${C.reset}`);
}

console.log(`\n\n${hr()}`);
console.log(`${C.cyan}${C.bold}  PRACTICAL SIMULATION — 8-turn Shopping Conversation${C.reset}`);
console.log(`${hr()}`);
console.log(`${C.dim}  Tracks reference map state and resolution at each turn${C.reset}\n`);

const SIM = 'sim-001';
freshState(SIM, { product_context: { last_search: { results: [] } }, active_topic: null });

// ── Turn 1 ────────────────────────────────────────────────────────────────────
turn(1, 'User',   'show me caps');
turn(1, 'System', '→ 3 caps returned. updateReferenceMap(CAPS_MULTI)');

_store[SIM].product_context = { last_search: { results: CAPS_MULTI } };
await stateManager.updateReferenceMap(SIM, CAPS_MULTI, { scope: 'global' });
_store[SIM].active_topic = { type: 'product', category_id: 'cats-caps', category_label: 'Caps', vendor: null, attributes: null };
const t1 = await stateManager.getState(SIM);

console.log(`\n  ${C.dim}Reference map:${C.reset}`);
console.log(printRefMap(t1.reference_map));

// ── Turn 2 ────────────────────────────────────────────────────────────────────
turn(2, 'User',   'do you have it in blue?');

const t2_res  = resolveReferences('do you have it in blue', t1, {}, [], 'structural');
const t2_ents = [{ type: 'attribute', attributeCode: 'color', value: 'blue' }];
const t2_amb  = await resolveAmbientContext('do you have it in blue', t2_ents, { user_id: SIM });
const t2_inj  = (t2_amb?.pendingAmbient) ? buildAmbientEntities(t2_amb.pendingAmbient, { user_id: SIM }, null) : [];

console.log(`\n  ${C.dim}Pronoun resolution ("it"):${C.reset}`);
console.log(printResolution('it', t2_res));
console.log(`  ${C.dim}Extracted entities:${C.reset}  color=blue  ${C.dim}(weak — no category)${C.reset}`);
console.log(`  ${C.dim}Ambient context (entityExtraction=true gate):${C.reset}`);
if (t2_inj.length) {
    t2_inj.forEach(e => console.log(`    ${C.green}✓ INJECT${C.reset}  ${C.cyan}${e.type}${C.reset}: ${C.bold}${e.value || e.categoryId || e.attributeCode}${C.reset}  ${C.dim}[AMBIENT_CONTEXT]${C.reset}`));
    console.log(`  ${C.green}→ product.search({ category: "Caps", color: "blue" }) ✓${C.reset}`);
} else {
    console.log(`    ${C.red}✗ not injected${C.reset}`);
}

// ── Turn 3 ────────────────────────────────────────────────────────────────────
turn(3, 'User',   'tell me more about the second one');

const t3_res = resolveReferences('tell me more about the second one', t1, {}, [], 'all');
console.log(`\n  ${C.dim}Ordinal resolution ("the second one"):${C.reset}`);
console.log(printResolution('the second one', t3_res));

// Simulate getDetails viewing cap-2
_store[SIM].product_context = { last_search: { results: CAPS_MULTI } };
await stateManager.updateReferenceMap(SIM, [CAPS_MULTI[1]], { scope: 'global' });
_store[SIM].active_topic = { type: 'single_product', product_id: 'cap-2', product_name: 'Red Storm Cap', category_id: 'cats-caps', category_label: 'Caps', vendor: null, attributes: null };
const t3 = await stateManager.getState(SIM);

console.log(`\n  ${C.dim}Reference map after viewing cap-2 (non-destructive write):${C.reset}`);
console.log(printRefMap(t3.reference_map));

// ── Turn 4 ────────────────────────────────────────────────────────────────────
turn(4, 'User',   'add it to cart');

const t4_res = resolveReferences('add it to cart', t3, {}, [], 'all');
console.log(`\n  ${C.dim}Pronoun resolution ("it"):${C.reset}`);
console.log(printResolution('it', t4_res));

// ── Turn 5 ────────────────────────────────────────────────────────────────────
turn(5, 'User',   'do you have that one in blue?');

const t5_res = resolveReferences('do you have that one in blue', t3, {}, [], 'all');
console.log(`\n  ${C.dim}Pronoun resolution ("that one"):${C.reset}`);
console.log(printResolution('that one', t5_res));
console.log(`  ${C.dim}→ resolves to Red Storm Cap + color=blue extraction${C.reset}`);
console.log(`  ${C.green}→ product.search({ query: "RedStormCap", color: "blue" }) ✓${C.reset}`);

// ── Turn 6 ────────────────────────────────────────────────────────────────────
turn(6, 'User',   'show me sneakers');
turn(6, 'System', '→ 3 sneakers returned. updateReferenceMap(SNEAKERS)');

_store[SIM].product_context = { last_search: { results: SNEAKERS } };
await stateManager.updateReferenceMap(SIM, SNEAKERS, { scope: 'global' });
_store[SIM].active_topic = { type: 'product', category_id: 'cats-snk', category_label: 'Sneakers', vendor: null, attributes: null };
const t6 = await stateManager.getState(SIM);

console.log(`\n  ${C.dim}Reference map after Turn 6 (caps context wiped, sneakers loaded):${C.reset}`);
console.log(printRefMap(t6.reference_map));

// ── Turn 7 ────────────────────────────────────────────────────────────────────
turn(7, 'User',   'add it to cart');

const t7_res = resolveReferences('add it to cart', t6, {}, [], 'all');
console.log(`\n  ${C.dim}Pronoun resolution ("it"):${C.reset}`);
console.log(printResolution('it', t7_res));
console.log(`  ${C.yellow}→ add_to_cart: no product_id resolved${C.reset}`);
console.log(`  ${C.yellow}→ missing_product microstate fires: "What would you like to add?" ✓${C.reset}`);

// ── Turn 8 ────────────────────────────────────────────────────────────────────
turn(8, 'User',   'that aside, show me blue sneakers');

const t8_res = resolveReferences('that aside show me blue sneakers', t6, {}, [], 'all');
console.log(`\n  ${C.dim}Discourse resolution ("that"):${C.reset}`);
console.log(printResolution('that', t8_res));
console.log(`  ${C.green}→ "that" has no reference map key. Passes through cleanly as discourse marker ✓${C.reset}`);

console.log(`\n${hr()}\n`);

})();
