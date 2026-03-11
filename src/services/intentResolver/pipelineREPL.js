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

            statements.forEach((statement, i) => {
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

                console.log(`\n${C.bold}${C.white}Top 5 Candidates via SchemaResolver:${C.reset}`);

                if (resolution.candidates.length === 0) {
                    console.log(`${C.red}  ✗ No matches scored above zero.${C.reset}`);
                } else {
                    resolution.candidates.slice(0, 5).forEach((c, idx) => {
                        const isWinner = resolution.winner && c.intentName === resolution.winner.intentName;
                        const prefix = isWinner ? `${C.green}  ★ ` : '    ';
                        const score = c.score.toFixed(2);
                        const fallbackLabel = (idx === 0 && resolution.fallbackUsed) ? ` ${C.yellow}(Fallback)${C.reset}` : '';

                        console.log(`${prefix}${C.bold}${idx + 1}. ${c.intentName}${C.reset} ${C.dim}Score: ${C.reset}${C.magenta}${score}${C.reset}${fallbackLabel}`);
                        if (c.matchedKeywords && c.matchedKeywords.length > 0) {
                            console.log(`${C.dim}     Keywords: [${C.reset}${c.matchedKeywords.join(', ')}${C.dim}]${C.reset}`);
                        }
                    });
                }
            });

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
