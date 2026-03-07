/**
 * PIPELINE TRACE TEST — Compact JSON output version
 * Run: node test_pipeline_trace.js
 */
const path = require('path');
const fs = require('fs');

// Silence all console output during the run
const origWarn = console.warn;
console.log = () => { };
console.warn = () => { };
console.error = () => { };
console.info = () => { };

const { cleanText } = require('./src/services/intentResolver/pipeline/nlpCleaner');
const { extractEntities } = require('./src/services/intentResolver/pipeline/entityExtractor');
const { resolveIntent } = require('./src/services/intentResolver/pipeline/schemaResolver');
const intentRegistry = require('./src/services/intentResolver/config/intentRegistry');

const EXPECTED_FACET = [
    "what colors of phones are available?",
    "which storage sizes do you have for laptops?",
    "list the brands of iphone you carry",
    "do you have phones made of titanium?",
    "what are the available RAM options for phones?",
    "what gigabytes of phones do you have?"
];
const EXPECTED_OTHER = [
    { q: "i want to buy an iphone", expected: "product_search" },
    { q: "show me samsung phones", expected: "product_search" },
    { q: "add the black one to my cart", expected: "add_to_cart" }
];

const allTests = [
    ...EXPECTED_FACET.map(q => ({ q, expected: 'facet_list' })),
    ...EXPECTED_OTHER
];

const idfMap = intentRegistry.buildIdfMap ? intentRegistry.buildIdfMap() : {};
const results = [];

for (const { q, expected } of allTests) {
    const cleaned = cleanText(q);
    const statement = { text: cleaned.toLowerCase(), negated: false };

    let extracted = { entities: {}, residualWords: [] };
    try { extracted = extractEntities(statement, {}, {}); } catch (e) { }

    const ent = extracted.entities || {};

    let winner = null;
    let topCandidates = [];
    try {
        const res = resolveIntent(extracted, cleaned, idfMap, {});
        winner = res.winner;
        topCandidates = (res.candidates || []).slice(0, 4).map(c => ({
            name: c.intentName,
            score: parseFloat((c.score || 0).toFixed(2))
        }));
    } catch (e) { }

    results.push({
        q,
        expected,
        won: winner ? winner.intentName : null,
        score: winner ? parseFloat((winner.score || 0).toFixed(2)) : null,
        pass: winner ? winner.intentName === expected : false,
        action: ent.action_verb || null,
        facet_target: ent.facet_target || null,
        discovery_meta: ent.discovery_meta || null,
        top4: topCandidates
    });
}

fs.writeFileSync('trace_results.json', JSON.stringify(results));
process.stdout.write('done\n');
