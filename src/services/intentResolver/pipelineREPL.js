require('dotenv').config();
const readline = require('readline');
const path = require('path');

// Pipeline Stage Imports
const fuzzyMatcher = require('./pipeline/fuzzyMatcher');
const contextResolver = require('./pipeline/contextResolver');
const preprocessor = require('./pipeline/preprocessor');
const { extractEntities } = require('./pipeline/entityExtractor');
const { resolveIntent } = require('./pipeline/schemaResolver');
const { resolveClausesGlobal } = require('../../utils/semanticClauseResolver');
const { cleanText } = require('./pipeline/nlpCleaner');
const { createPositionTracker } = require('./pipeline/extractionPositionTracker');
const intentRegistry = require('./config/intentRegistry');

const C = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    red: '\x1b[31m',
    dim: '\x1b[2m',
    magenta: '\x1b[35m',
    white: '\x1b[37m'
};

const idfMap = intentRegistry.buildIdfMap();
const dummyState = {
    user_id: 'repl-user',
    product_context: {},
    reference_map: {}
};
const dummyStoreContext = {
    VENDORS: {},
    CATEGORIES: []
};

function main() {
    console.log(`
${C.bold}${C.cyan}╔══════════════════════════════════════════════╗
║          be3-ai Pipeline Diagnostic REPL      ║
╚══════════════════════════════════════════════╝${C.reset}
${C.dim}Mode: Deterministic + Schema Scoring + Semantic Fallback${C.reset}
${C.dim}Stage: 4b (Schema Resolver)${C.reset}
`);

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: `${C.cyan}❯ ${C.reset}`
    });

    rl.prompt();

    rl.on('line', async (line) => {
        const userMessage = line.trim();

        if (!userMessage) {
            rl.prompt();
            return;
        }

        if (userMessage === ':q' || userMessage === ':quit' || userMessage === 'exit') {
            rl.close();
            return;
        }

        try {
            console.log(`${C.dim}--- Processing Pipeline ---${C.reset}`);

            // 1. Fuzzy
            const afterFuzzy = fuzzyMatcher.correctText(userMessage, dummyStoreContext);
            if (userMessage !== afterFuzzy) {
                console.log(`${C.yellow}  Fuzzy Fix: ${C.reset}"${afterFuzzy}"`);
            }

            // 2. Context
            const { resolvedText: afterContext, resolutions } = contextResolver.resolveReferences(afterFuzzy, dummyState, dummyStoreContext);

            // 3. Preprocess
            const { statements } = preprocessor.preprocess(afterContext);

            // 3a. Global Pre-pass
            const { globalEntities, categoryHints: globalCategoryHints } = resolveClausesGlobal(afterContext, resolutions);
            const globalWords = afterContext.toLowerCase().split(/\s+/).filter(w => w.length > 0);

            for (let i = 0; i < statements.length; i++) {
                const statement = statements[i];
                if (statements.length > 1) {
                    console.log(`\n${C.bold}${C.white}Statement ${i + 1}: ${C.reset}"${statement.text}"`);
                }

                const cleanedText = cleanText(statement.text);

                // 3d. Reconcile
                const localWords = cleanedText.toLowerCase().split(/\s+/).filter(w => w.length > 0);
                const statementPreEntities = [];
                for (const gEnt of globalEntities) {
                    const globalWord = globalWords[gEnt.globalWordIndex];
                    if (!globalWord) continue;
                    const localIdx = localWords.indexOf(globalWord);
                    if (localIdx !== -1) {
                        statementPreEntities.push({ ...gEnt, localWordIndex: localIdx });
                    }
                }

                // 4a. Entity Extraction
                const positionTracker = createPositionTracker();
                const extractionResult = extractEntities(cleanedText, dummyStoreContext, idfMap, positionTracker, resolutions, statementPreEntities, globalCategoryHints);

                if (extractionResult.entities.length > 0) {
                    const entityList = extractionResult.entities.map(e => `${C.cyan}${e.type}${C.reset}:${C.yellow}${e.value || e.verb}${C.reset}`).join(', ');
                    console.log(`${C.dim}  Entities: ${C.reset}${entityList}`);
                }

                // 4b. Schema Resolution
                const resolution = resolveIntent(extractionResult, cleanedText, idfMap, dummyStoreContext);

                let finalCandidates = resolution.candidates.map(c => ({
                    intentName: c.intentName,
                    score: c.score,
                    matchedKeywords: c.matchedKeywords,
                    breakdown: { deterministic: c.score, semantic: 0 }
                }));

                // --- Transformer Integration (Hierarchical: L1→L2→L3) ---
                try {
                    const transformerClient = require('./pipeline/transformerClient');
                    const hierarchical = await transformerClient.classifyHierarchical(cleanedText);

                    if (hierarchical.class) {
                        console.log(`\n${C.bold}${C.white}Hierarchical Classification:${C.reset}`);
                        const l1Score = hierarchical.l1?.scores?.[0]?.score?.toFixed(3) || 'hint';
                        const l2Score = hierarchical.l2?.scores?.[0]?.score?.toFixed(3) || 'N/A';
                        const l3Score = hierarchical.l3?.scores?.[0]?.score?.toFixed(3) || 'N/A';
                        console.log(`  ${C.cyan}L1 Class:${C.reset}     ${C.bold}${hierarchical.class}${C.reset} ${C.dim}(${l1Score})${C.reset}${hierarchical.classSkipped ? ` ${C.yellow}[hint]${C.reset}` : ''}`);
                        console.log(`  ${C.cyan}L2 Intent:${C.reset}    ${C.bold}${hierarchical.intent || '—'}${C.reset} ${C.dim}(${l2Score})${C.reset}`);
                        console.log(`  ${C.cyan}L3 SubIntent:${C.reset} ${C.bold}${hierarchical.subIntent || '—'}${C.reset} ${C.dim}(${l3Score})${C.reset}`);
                        console.log(`  ${C.dim}Duration: ${hierarchical.totalDuration}ms${C.reset}`);

                        // Inject L3 scores as semantic points
                        if (hierarchical.l3 && hierarchical.l3.scores) {
                            for (const sem of hierarchical.l3.scores) {
                                const semanticPoints = (sem.score || 0) * 10.0;
                                const existing = finalCandidates.find(c => c.intentName === sem.name);
                                if (existing) {
                                    existing.score += semanticPoints;
                                    existing.breakdown.semantic = semanticPoints;
                                } else {
                                    finalCandidates.push({
                                        intentName: sem.name,
                                        score: semanticPoints,
                                        matchedKeywords: ['semantic'],
                                        breakdown: { deterministic: 0, semantic: semanticPoints }
                                    });
                                }
                            }
                        }
                    }
                } catch (err) {
                    console.log(`${C.yellow}  ⚠️ Transformer skip: ${err.message}${C.reset}`);
                }

                finalCandidates.sort((a, b) => b.score - a.score);

                console.log(`\n${C.bold}${C.white}Top 5 Merged Candidates (Deterministic + Semantic):${C.reset}`);

                if (finalCandidates.length === 0) {
                    console.log(`${C.red}  ✗ No matches scored above zero.${C.reset}`);
                } else {
                    finalCandidates.slice(0, 5).forEach((c, idx) => {
                        const score = c.score.toFixed(2);
                        const det = c.breakdown.deterministic.toFixed(1);
                        const sem = c.breakdown.semantic.toFixed(1);

                        console.log(`  ${C.bold}${idx + 1}. ${c.intentName}${C.reset} ${C.dim}Score: ${C.reset}${C.magenta}${score}${C.reset} ${C.dim}(Det:${det} + Sem:${sem})${C.reset}`);
                        if (c.matchedKeywords && c.matchedKeywords.length > 0) {
                            console.log(`${C.dim}     Keywords: [${C.reset}${c.matchedKeywords.join(', ')}${C.dim}]${C.reset}`);
                        }
                    });
                }
            }

        } catch (err) {
            console.log(`${C.red}  ✗ Pipeline Error: ${err.message}${C.reset}`);
            console.error(err);
        }

        console.log('');
        rl.prompt();
    });

    rl.on('close', () => {
        console.log(`${C.dim}REPL Closed.${C.reset}`);
        process.exit(0);
    });
}

main();
