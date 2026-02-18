const readline = require('readline');
const { resolveAndMap } = require('../src/services/intentResolver');
const stateManager = require('../src/state/stateManager');
const { executeTools } = require('../src/core/orchestrator');
const storeContext = require('../src/context/storeContext');

// ═══════════════════════════════════════════════════
//  Constants & Config
// ═══════════════════════════════════════════════════
const TEST_SESSION_ID = 'repl_test_session';
let verbose = false;

// ═══════════════════════════════════════════════════
//  Mock AI (Deterministic Extraction - NO API KEY)
// ═══════════════════════════════════════════════════
// Refined filler list using both manual list and linguistic markers
const { cleanText, stripSocialNoise, cleanQuery } = require('../src/services/intentResolver/pipeline/nlpCleaner');

function cleanMessageForExtraction(text) {
    if (!text) return "";

    // 1. Core NLP cleanup (Strips pronouns, conjunctions, prepositions)
    const cleaned = cleanQuery(text);

    // 2. Manual filler list for specific desire verbs and noise
    const fillers = [
        'need', 'want', 'buy', 'purchase', 'get', 'order', 'show', 'view', 'see',
        'you', 'your', 'me', 'my', 'i', 'the', 'a', 'an', 'some', 'any',
        'love', 'like', 'hate', 'really', 'seriously', 'actually', 'just',
        'please', 'thanks', 'thank you', 'how', 'what', 'where', 'when'
    ];

    let words = cleaned.split(/\s+/);
    words = words.filter(w => !fillers.includes(w));

    return words.join(' ');
}

/**
 * Simulates AI parameter extraction using deterministic logic.
 * This keeps the REPL fast and offline-capable.
 */
async function mockAiQuery(messages) {
    const userMsg = messages.find(m => m.role === 'user')?.content || '';
    // Handle the case where the message might be a prompt structure or a raw string
    const textMatch = userMsg.match(/\"(.*?)\"/);
    const text = (textMatch ? textMatch[1] : userMsg).toLowerCase();

    const products = [];
    const knownProducts = [
        'iphone 12', 'iphone 14', 'iphone 13', 'iphone xs max',
        'galaxy s23', 'galaxy s24', 'infinix hot 30 i', 'macbook pro',
        'samsung a54', 'tecno spark 10', 'xiaomi redmi note 12',
        'surround sound headset'
    ];

    // Check for exact known product phrases first
    for (const product of knownProducts) {
        if (text.includes(product)) {
            products.push(product);
            break;
        }
    }

    // Simulate attribute extraction
    const attributes = {};
    const colors = ['red', 'blue', 'green', 'black', 'white', 'gold', 'silver'];
    const sizes = ['small', 'medium', 'large', 'xl', '64gb', '128gb', '256gb', '512gb', '12', '13', '14'];

    for (const c of colors) {
        if (text.includes(c)) attributes.color = c;
    }
    for (const s of sizes) {
        if (text.includes(s) && !products.some(p => p.includes(s))) {
            attributes.size = s;
        }
    }

    // Strip common "verb" fillers to simulate precise extraction
    let query = cleanMessageForExtraction(text);

    const finalQuery = query.trim() || null;

    // If we have a query but no known products match, treat the whole query as the product
    // e.g. "iphone 17" -> finalQuery: "iphone 17", products: ["iphone 17"]
    let finalProducts = products.length > 0 ? products : (finalQuery ? [finalQuery] : null);

    const inferredCategory = text.includes('phone') ? 'phones' : (text.includes('laptop') ? 'laptops' : null);

    // Mutual Exclusivity: Only provide category if no specific query exists, and vice-versa
    let finalCategory = null;
    let finalQueryVal = finalQuery;

    if (finalQuery && finalQuery !== inferredCategory) {
        // We have a specific query that isn't just the category name
        finalCategory = null;
    } else if (inferredCategory) {
        // We have a category, and query is either null or same as category
        finalCategory = inferredCategory;
        finalQueryVal = null; // Leave out query when we have category
    }

    return JSON.stringify({
        products: finalProducts,
        product_name: finalQueryVal,
        query: finalQueryVal,
        category: finalCategory,
        vendor: text.includes('apple') ? 'apple' : (text.includes('samsung') ? 'samsung' : null),
        attributes: Object.keys(attributes).length > 0 ? attributes : null
    });
}

// ═══════════════════════════════════════════════════
//  Display Helpers
// ═══════════════════════════════════════════════════
const C = {
    reset: '\x1b[0m',
    dim: '\x1b[2m',
    bold: '\x1b[1m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    red: '\x1b[31m',
    magenta: '\x1b[35m',
    white: '\x1b[37m'
};

function printResult(result, executionResults = []) {
    console.log('');

    // Pipeline Trace
    if (verbose) {
        console.log(`${C.dim}── Pipeline Trace ──${C.reset}`);
        console.log(`${C.dim}  Original:  ${C.reset}${result.corrections.original}`);
        console.log(`${C.dim}  Fuzzy:     ${C.reset}${result.corrections.afterFuzzy}`);
        console.log(`${C.dim}  Context:   ${C.reset}${result.corrections.afterContext}`);
        if (result.resolutions.length > 0) {
            console.log(`${C.dim}  Resolved:  ${C.reset}${result.resolutions.map(r => `"${r.original}" → "${r.resolved}"`).join(', ')}`);
        }
    }

    // Intents
    if (result.intents.length === 0) {
        console.log(`${C.red}${C.bold}  ✗ No intent detected${C.reset}`);
    } else {
        for (let i = 0; i < result.intents.length; i++) {
            const intent = result.intents[i];
            const label = result.isMultiIntent ? `  Intent ${i + 1}` : '  Intent';
            console.log(`${C.cyan}${C.bold}${label}: ${intent.intentName}${C.reset} ${C.dim}(score: ${intent.score?.toFixed(2) || 'N/A'})${C.reset}`);

            // Show extracted params
            if (intent.parameters && Object.keys(intent.parameters).length > 0) {
                const paramStr = Object.entries(intent.parameters)
                    .filter(([, v]) => v !== null && v !== undefined)
                    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
                    .join(', ');
                if (paramStr) {
                    console.log(`${C.dim}    params: { ${paramStr} }${C.reset}`);
                }
            }
        }
    }

    // Tools & Execution
    if (executionResults.length > 0) {
        console.log('');
        for (const er of executionResults) {
            const color = er.success ? C.green : C.red;
            const status = er.success ? '✓' : '✗';
            console.log(`${color}${C.bold}  ${status} ${er.tool}${C.reset}`);

            if (er.result && er.result.message) {
                console.log(`    ${C.white}${er.result.message}${C.reset}`);
            }

            // If search result, show count
            if (er.result && (er.result.products || er.result.results)) {
                const prods = er.result.products || er.result.results;
                const count = prods.length;
                console.log(`    ${C.dim}Found ${count} products${C.reset}`);
            }

            if (er.error) {
                console.log(`    ${C.red}Error: ${er.error}${C.reset}`);
            }
        }
    }

    console.log('');
}

async function printState() {
    const state = await stateManager.getState(TEST_SESSION_ID);
    console.log(`\n${C.cyan}── Current User State ──${C.reset}`);
    const results = state.product_context?.last_search?.results || [];
    console.log(`${C.dim}  Last search: "${state.product_context?.last_search?.query || 'none'}"${C.reset}`);
    for (let i = 0; i < results.length; i++) {
        console.log(`${C.dim}    [${i + 1}] ${results[i].name || results[i].title}${C.reset}`);
    }
    console.log(`${C.dim}  Cart items: ${state.cart?.item_count || 0}${C.reset}`);
    console.log(`${C.dim}  Viewing: ${state.product_context?.currently_viewing || 'none'}${C.reset}`);
    console.log(`${C.dim}  Verbose: ${verbose ? 'on' : 'off'}${C.reset}\n`);
}

async function initializeSession() {
    console.log(`${C.dim}Initializing REPL session...${C.reset}`);
    // Start fresh
    await stateManager.clearState(TEST_SESSION_ID);

    // Seed with a mock interaction if needed (optional)
    // await stateManager.updateState(TEST_SESSION_ID, { ... });
}

// ═══════════════════════════════════════════════════
//  REPL
// ═══════════════════════════════════════════════════
async function main() {
    console.log(`
${C.bold}${C.cyan}╔═══════════════════════════════════════════════╗
║     Hybrid Intent Resolver — Offline Tool REPL ║
╚═══════════════════════════════════════════════╝${C.reset}
`);

    await initializeSession();

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: `${C.green}❯ ${C.reset}`
    });

    rl.prompt();

    rl.on('line', async (line) => {
        const input = line.trim();
        if (!input) { rl.prompt(); return; }

        if (input === ':quit' || input === ':q' || input === 'exit') {
            console.log(`${C.dim}Goodbye!${C.reset}`);
            process.exit(0);
        }
        if (input === ':state') { await printState(); rl.prompt(); return; }
        if (input === ':reset') {
            await stateManager.clearState(TEST_SESSION_ID);
            console.log(`${C.green}  ✓ State reset${C.reset}\n`);
            rl.prompt(); return;
        }
        if (input.startsWith(':verbose')) {
            verbose = !verbose;
            console.log(`${C.green}  ✓ Verbose: ${verbose ? 'on' : 'off'}${C.reset}\n`);
            rl.prompt(); return;
        }

        // Resolve & Execute
        try {
            const start = Date.now();
            const state = await stateManager.getState(TEST_SESSION_ID);

            // 1. Resolve (using the DETREMINISTIC logic the user loves)
            const result = await resolveAndMap(input, state, mockAiQuery, storeContext);

            // 2. Execute Tools (REAL tools via orchestrator)
            let executionResults = [];
            if (result.tools.length > 0) {
                executionResults = await executeTools(result.tools, TEST_SESSION_ID);
            }

            const ms = Date.now() - start;

            printResult(result, executionResults);
            console.log(`${C.dim}  ⏱ ${ms}ms${C.reset}\n`);
        } catch (err) {
            console.log(`${C.red}  Error: ${err.message}${C.reset}\n`);
            if (verbose) console.error(err.stack);
        }

        rl.prompt();
    });

    rl.on('close', () => {
        console.log(`\n${C.dim}Goodbye!${C.reset}`);
        process.exit(0);
    });
}

main();
