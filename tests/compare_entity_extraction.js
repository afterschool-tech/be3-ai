/**
 * mini-REPL for Entity Extraction Comparison (Deterministic vs. Hybrid)
 * Compares extraction results with and without Stage 0.5 Transformer context.
 */

require('dotenv').config();
const path = require('path');
const axios = require('axios');
const readline = require('readline');

// Core logic imports
const { extractEntities } = require('../src/services/intentResolver/pipeline/entityExtractor');
const { resolveClausesGlobal } = require('../src/utils/semanticClauseResolver');
const intentRegistry = require('../src/services/intentResolver/config/intentRegistry');
const storeContext = require('../src/context/storeContext');

// Build IDF map once (used by entityExtractor for action verbs)
const idfMap = intentRegistry.buildIdfMap();

// Configuration
const BASE_URL = process.env.TRANSFORMER_URL || 'http://localhost:3009';
const TRANSFORMER_URL = `${BASE_URL}/analyze`;

// Colors for display
const C = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    red: '\x1b[31m',
    magenta: '\x1b[35m',
    white: '\x1b[37m',
    blue: '\x1b[34m',
    dim: '\x1b[2m'
};

/**
 * Calls the real Transformer service to get semantic context
 */
async function getSemanticContext(text) {
    try {
        const response = await axios.post(TRANSFORMER_URL, {
            text: text
        }, { timeout: 10000 });

        return {
            available: true,
            classification: response.data.classification || [],
            entities: response.data.entities || {},
            confidence: response.data.confidence || {},
            duration: response.data.duration || 0
        };
    } catch (err) {
        return { available: false, error: err.message };
    }
}

/**
 * Runs a full extraction pass
 */
function runExtraction(text, transformerContext = null) {
    // 1. Pre-pass (Stage 3)
    const prepass = resolveClausesGlobal(text, [], transformerContext);

    // 2. Entity Extractor (Stage 4a)
    // Signature: extractEntities(text, storeContext, idfMap, positionTracker, resolutions, preDetectedEntities, categoryHints, semanticContext)
    const result = extractEntities(
        text,
        storeContext,       // Pass real storeContext (CATEGORIES, VENDORS, etc)
        idfMap,             // Pass real idfMap
        null,               // positionTracker
        [],                 // resolutions
        prepass.globalEntities, // preDetectedEntities
        prepass.categoryHints,  // categoryHints
        transformerContext      // semanticContext
    );

    return {
        prepass,
        entities: result.entities,
        categoryHints: result.categoryHints,
        residualWords: result.residualWords
    };
}

function printEntities(label, result) {
    console.log(`${C.bold}${C.blue}─── ${label} ───${C.reset}`);

    // Categories
    const categories = result.entities.filter(e => e.type === 'category');
    console.log(`${C.cyan}[Categories]${C.reset}`);
    if (categories.length === 0) console.log(`  None`);
    categories.forEach(c => {
        const source = c.source || 'lexical';
        const meta = c.matchMeta || {};
        const scoreInfo = meta.lexScore ? ` (lex: ${meta.lexScore.toFixed(1)}, sem: ${meta.semanticBoost?.toFixed(1) || 0})` : '';
        console.log(`  • ${C.bold}${c.id}${C.reset} [Tier ${meta.lexTier || meta.tier || '?'}] ${C.dim}${source}${scoreInfo}${C.reset}`);
    });

    // Vendors
    const vendors = result.entities.filter(e => e.type === 'vendor');
    console.log(`${C.yellow}[Vendors]${C.reset}`);
    if (vendors.length === 0) console.log(`  None`);
    vendors.forEach(v => {
        const source = v.source || 'lexical';
        console.log(`  • ${C.bold}${v.value}${C.reset} ${C.dim}${source}${C.reset}`);
    });

    // Clauses & Brands (from Prepass)
    const clauses = result.entities.filter(e => e.type === 'clause' || e.type === 'brand');
    console.log(`${C.magenta}[Clauses/Brands]${C.reset}`);
    if (clauses.length === 0) console.log(`  None`);
    clauses.forEach(cl => {
        const semScore = cl.semanticScore ? ` (semConf: ${cl.semanticScore.toFixed(2)})` : '';
        console.log(`  • ${C.bold}${cl.clauseId}${C.reset} [${cl.attribute}] ${C.dim}${cl.source}${semScore}${C.reset}`);
    });

    // Facet Targets
    const targets = result.entities.filter(e => e.type === 'facet_target' || e.type === 'target_facet');
    console.log(`${C.green}[Facet Targets]${C.reset}`);
    if (targets.length === 0) console.log(`  None`);
    targets.forEach(t => {
        console.log(`  • ${C.bold}${t.value}${C.reset} [Target: ${t.attribute}] ${C.dim}${t.source}${C.reset}`);
    });

    // Actions
    const actions = result.entities.filter(e => e.type === 'action');
    console.log(`${C.white}[Actions]${C.reset}`);
    if (actions.length === 0) console.log(`  None`);
    actions.forEach(a => {
        console.log(`  • ${C.bold}${a.verb}${C.reset} [Category: ${a.category}]`);
    });

    // Residual Words
    console.log(`${C.dim}[Residual Words]${C.reset} ${result.residualWords.join(', ')}`);
    console.log('');
}

async function main() {
    process.env.DEBUG = 'ENTITY:*'; // Enable debug logs hidden in pipeline

    console.log(`${C.bold}${C.white}╔═══════════════════════════════════════════════╗`);
    console.log(`║   Entity Extraction Comparison Mini-REPL      ║`);
    console.log(`╚═══════════════════════════════════════════════╝${C.reset}\n`);

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: `${C.green}Query ❯ ${C.reset}`
    });

    rl.prompt();

    rl.on('line', async (line) => {
        const text = line.trim();
        if (!text) { rl.prompt(); return; }
        if (text === 'exit' || text === ':q') process.exit(0);

        console.log(`\n${C.dim}Processing: "${text}"...${C.reset}\n`);

        try {
            // 1. Without Transformer
            const resultLegacy = runExtraction(text, null);
            printEntities("FLAVOR 1: Deterministic (No Transformer)", resultLegacy);

            // 2. Get Semantic Context
            console.log(`${C.dim}Fetching Transformer Analysis...${C.reset}`);
            const context = await getSemanticContext(text);

            if (!context.available) {
                console.log(`${C.red}⚠️ Transformer Service unavailable: ${context.error}${C.reset}\n`);
            } else {
                const confValues = Object.values(context.confidence);
                const maxConf = confValues.length > 0 ? Math.max(...confValues) : 0;
                const topInt = context.classification?.[0];

                console.log(`${C.dim}Transformer Confidence (Max Entity): ${(maxConf * 100).toFixed(1)}%${C.reset}`);
                if (topInt) {
                    console.log(`${C.dim}Top Intent Recommendation: ${topInt.intentName} (${(topInt.score * 100).toFixed(1)}%)${C.reset}`);
                }
                console.log('');

                // 3. With Transformer
                const resultHybrid = runExtraction(text, context);
                printEntities("FLAVOR 2: Hybrid (Transformer Enabled)", resultHybrid);

                // Highlight differences
                const legacyIds = new Set(resultLegacy.entities.map(e => `${e.type}:${e.value || e.verb}:${e.clauseId || ''}`));
                const hybridIds = new Set(resultHybrid.entities.map(e => `${e.type}:${e.value || e.verb}:${e.clauseId || ''}`));

                const gained = resultHybrid.entities.filter(e => !legacyIds.has(`${e.type}:${e.value || e.verb}:${e.clauseId || ''}`));
                if (gained.length > 0) {
                    console.log(`${C.bold}${C.green}✨ HYBRID GAINS:${C.reset}`);
                    gained.forEach(g => console.log(`  [+] ${g.type}: ${g.value || g.verb || g.clauseId}`));
                }

                const promoted = resultHybrid.entities.filter(e => {
                    const legacy = resultLegacy.entities.find(le => le.type === e.type && (le.value === e.value || le.verb === e.verb));
                    const lTier = legacy?.matchMeta?.lexTier || 0;
                    const hTier = e.matchMeta?.lexTier || 0;
                    return legacy && hTier > lTier;
                });
                if (promoted.length > 0) {
                    console.log(`${C.bold}${C.cyan}📈 TIER PROMOTIONS:${C.reset}`);
                    promoted.forEach(p => {
                        const legacy = resultLegacy.entities.find(le => le.type === p.type && (le.value === p.value || le.verb === p.verb));
                        const lTier = legacy.matchMeta?.lexTier || 0;
                        const hTier = p.matchMeta?.lexTier || 0;
                        console.log(`  [↑] ${p.id || p.value}: Tier ${lTier} ➔ Tier ${hTier}`);
                    });
                }
                console.log('');
            }
        } catch (err) {
            console.error(`${C.red}Error processing query: ${err.message}${C.reset}`);
            if (err.stack) console.error(err.stack);
        }

        rl.prompt();
    });
}

main();
