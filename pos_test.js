/**
 * POS Gate Independent Test Suite
 * Tests the posAnalyzer logic directly, verifying negative filtering, whitelist bypass,
 * and multi-word phrase evaluation.
 */

const { 
    tagWords, 
    isDisqualified, 
    phrasePassesPosGate 
} = require('./src/services/intentResolver/pipeline/posAnalyzer');

const C = { reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m', bold: '\x1b[1m' };

let passed = 0; let failed = 0;
function assert(name, condition) {
    if (condition) { passed++; console.log(`  ${C.green}✓${C.reset} ${name}`); } 
    else { failed++; console.log(`  ${C.red}✗${C.reset} ${name}`); }
}
function section(title) { console.log(`\n${C.bold}━━━ ${title} ━━━${C.reset}`); }

console.log(`${C.bold}Testing POS Gate Analyzer...${C.reset}`);

// Simulated whitelist for tests
// 'caps' is a perfect example: compromise often tags it as a Verb ("he caps the bottle"), 
// but it's a valid category name. The whitelist protects it.
const mockWhitelist = new Set(['phones', 'apple', 'bimpe', 'affordable', 'caps']);

// ── Test Sentences ──
const text1 = "i am looking for affordable phones and Bimpe caps";
const map1 = tagWords(text1);

const text2 = "show me 256GB storage really quickly";
const map2 = tagWords(text2);

const text3 = "brand new high quality";
const map3 = tagWords(text3);

// ── Tests ──

section('1. Verbs and Adverbs are Blocked');
assert('"looking" (Gerund/Verb) is disqualified', isDisqualified('looking', map1, mockWhitelist) === true);
assert('"am" (Copula/Verb) is disqualified', isDisqualified('am', map1, mockWhitelist) === true);
assert('"really" (Adverb) is disqualified', isDisqualified('really', map2, mockWhitelist) === true);
assert('"quickly" (Adverb) is disqualified', isDisqualified('quickly', map2, mockWhitelist) === true);

section('2. Nouns and Adjectives are Allowed');
assert('"storage" (Noun) is allowed', isDisqualified('storage', map2, mockWhitelist) === false);
assert('"high" (Adjective) is allowed', isDisqualified('high', map3, mockWhitelist) === false);
assert('"quality" (Noun) is allowed', isDisqualified('quality', map3, mockWhitelist) === false);

section('3. Cardinals are Allowed');
assert('"256GB" (Cardinal) is allowed', isDisqualified('256gb', map2, mockWhitelist) === false);

section('4. Whitelist Bypasses Gate');
// 'Bimpe' is capitalized in text1. Let's make sure lookup handles it.
assert('Whitelist word "affordable" is allowed', isDisqualified('affordable', map1, mockWhitelist) === false);
assert('Whitelist word "phones" is allowed', isDisqualified('phones', map1, mockWhitelist) === false);
assert('Whitelist word "bimpe" is allowed', isDisqualified('bimpe', map1, mockWhitelist) === false);
assert('Whitelist word "caps" is allowed despite Verb tag', isDisqualified('caps', map1, mockWhitelist) === false);

section('5. Multi-word Phrases');
// "brand new" -> "brand" (Noun), "new" (Adjective) -> Passes
assert('"brand new" phrase passes (both valid)', phrasePassesPosGate(['brand', 'new'], map3, mockWhitelist) === true);

// "really quickly" -> "really" (Adverb), "quickly" (Adverb) -> Blocked
assert('"really quickly" phrase blocked (all invalid)', phrasePassesPosGate(['really', 'quickly'], map2, mockWhitelist) === false);

// "looking quickly" -> Verb + Adverb -> Blocked
const mapMixed = tagWords("looking quickly");
assert('"looking quickly" phrase blocked', phrasePassesPosGate(['looking', 'quickly'], mapMixed, mockWhitelist) === false);

// "looking for phones" -> Verb + Prep + Whitelist Noun -> Passes because 'phones' is valid
const mapMixed2 = tagWords("looking for phones");
assert('"looking for phones" phrase passes (has 1 valid)', phrasePassesPosGate(['looking', 'for', 'phones'], mapMixed2, mockWhitelist) === true);

// ── Summary ──
console.log(`\n${'-'.repeat(30)}`);
if (failed === 0) {
    console.log(`${C.green}All ${passed} POS tests passed ✓${C.reset}\n`);
} else {
    console.log(`${C.red}${failed} tests failed${C.reset} out of ${passed + failed}\n`);
    process.exit(1);
}
