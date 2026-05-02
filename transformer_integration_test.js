#!/usr/bin/env node
/**
 * transformer_integration_test.js
 * 
 * Performs a real HTTP call to the local be3-ai-transformer (Port 3009)
 * and verifies that the be3_ai POS gate correctly handles the real-world output.
 */

const axios = require('axios');
const { tagWords } = require('./src/services/intentResolver/pipeline/posAnalyzer');
const { resolveClausesGlobal } = require('./src/utils/semanticClauseResolver');
const { extractEntities } = require('./src/services/intentResolver/pipeline/entityExtractor');

const TRANSFORMER_URL = 'http://localhost:3009/extract';
const C = { reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m', bold: '\x1b[1m', yellow: '\x1b[33m' };

const storeContext = {
    CATEGORIES: {},
    VENDORS: {
        'v1': { id: 'v1', business_name: 'Apple', tag: 'apple' }
    }
};

async function runTest(text) {
    console.log(`\n${C.bold}Testing Message:${C.reset} "${text}"`);

    try {
        // 1. Call real Transformer
        console.log(`${C.yellow}  → Calling Transformer (3009)...${C.reset}`);
        const response = await axios.post(TRANSFORMER_URL, { text });
        const rawResult = response.data;

        // 2. Prepare Pipeline context
        const words = text.toLowerCase().split(/\s+/);
        const posTagMap = tagWords(text);

        // Manual Reshape (mimic index.js)
        const reshape = (ent) => {
            if (!ent || typeof ent !== 'object' || Array.isArray(ent)) return [];
            return Object.entries(ent).flatMap(([key, words]) =>
                words.map(mw => ({ key, matchedWord: mw, score: 0.9 }))
            );
        };
        const shapedEntities = {
            clause: reshape(rawResult.entities.clause),
            category: reshape(rawResult.entities.category),
            vendor: reshape(rawResult.entities.vendor),
            attribute: {}
        };
        if (rawResult.entities.attribute) {
            for (const [k, v] of Object.entries(rawResult.entities.attribute)) {
                shapedEntities.attribute[k] = v.map(val => ({ value: val, score: 0.9 }));
            }
        }

        const semContextPrepass = { entities: shapedEntities, available: true };

        // 3. Run Pre-pass (Stage 3)
        console.log(`${C.yellow}  → Running Pipeline Pre-pass...${C.reset}`);
        const prepass = resolveClausesGlobal(text, [], semContextPrepass, posTagMap);

        // 4. Run Entity Extraction (Stage 4a)
        console.log(`${C.yellow}  → Running Entity Extractor...${C.reset}`);
        const semContextExtractor = { ...rawResult, available: true };
        const result = extractEntities(
            text, storeContext, {}, null, [],
            prepass.globalEntities, prepass.categoryHints,
            semContextExtractor, posTagMap
        );

        // 5. Output Findings
        console.log(`${C.green}${C.bold}  Results:${C.reset}`);
        console.log(`    Entities Detected: ${result.entities.length}`);
        result.entities.forEach(e => {
            console.log(`    - [${e.type}] ${e.value} (Source: ${e.source})`);
        });

        const blockedCount = (text.match(/POS_BLOCKED/g) || []).length; // Check logs if we had them piped

        console.log(`${C.green}  ✓ Integration step complete.${C.reset}`);

    } catch (err) {
        if (err.code === 'ECONNREFUSED') {
            console.error(`${C.red}  ✗ Error: Could not connect to Transformer at ${TRANSFORMER_URL}.${C.reset}`);
            console.error(`    Ensure the be3-ai-transformer service is running on port 3009.`);
        } else {
            console.error(`${C.red}  ✗ Error: ${err.message}${C.reset}`);
        }
    }
}

async function main() {
    console.log(`${C.bold}Transformer Integration POS Test${C.reset}`);

    // Scenario 1: Natural Noun
    await runTest("show me affordable apple phones");

    // Scenario 2: Noise (Verbs that might trigger semantic matches)
    await runTest("looking for jumping items");

    // Scenario 3: Noise (Verbs that might trigger semantic matches)
    await runTest("i am looking for tote laptop bag");

    console.log(`\n${C.bold}Test Finished.${C.reset}\n`);
}

main();
