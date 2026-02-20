console.log('💎 REPL ID: ALPHA-10-SEC');
const path = require('path');
const fs = require('fs');
const LOG_FILE = path.join(__dirname, '../debug_trace.log');
fs.writeFileSync(LOG_FILE, `=== START SESSION ${new Date().toISOString()} ===\n`);

const readline = require('readline');
const { resolveAndMap } = require('../src/services/intentResolver');
const stateManager = require('../src/state/stateManager');
const { executeTools } = require('../src/core/orchestrator');
const storeContext = require('../src/context/storeContext');
const { CLAUSES } = require('../src/context/clauses');

// ═══════════════════════════════════════════════════
//  Constants & Config
// ═══════════════════════════════════════════════════
const TEST_SESSION_ID = 'repl_test_session';
let verbose = false;

// ═══════════════════════════════════════════════════
//  Mock AI (Context-Aware Deterministic Extraction)
// ═══════════════════════════════════════════════════
const { cleanQuery } = require('../src/services/intentResolver/pipeline/nlpCleaner');

/**
 * Simulates AI parameter extraction using deterministic logic.
 * IMPORTANT: Extracts only the quoted user message from the prompt,
 * NOT the full prompt text (which contains parameter descriptions
 * with example values that would cause false matches).
 */
async function mockAiQuery(messages) {
    const userMsg = messages.find(m => m.role === 'user')?.content || '';

    // Extract ONLY the quoted user message from the extraction prompt.
    // The prompt format is: Extract parameters from this message:\n"actual user text"\n...
    // We must NOT match against parameter descriptions (they contain example values).
    const quotedMatch = userMsg.match(/"([^"]+)"/);
    const text = quotedMatch ? quotedMatch[1].toLowerCase() : userMsg.toLowerCase();

    const extracted = {
        products: null,
        product_name: null,
        category: null,
        vendor: null,
        attributes: null,
        clause_words: null,
        quantity: null,
        order_id: null
    };

    // 1. Detect Category from Context
    for (const [id, cat] of Object.entries(storeContext.CATEGORIES)) {
        if (text.includes(cat.label.toLowerCase())) {
            extracted.category = id;
            break;
        }
    }

    // 2. Detect Vendor from Context (Only Official Tenants)
    for (const [id, v] of Object.entries(storeContext.VENDORS)) {
        if (text.includes(v.business_name.toLowerCase()) || (v.tag && text.includes(v.tag.toLowerCase()))) {
            extracted.vendor = id;
            break;
        }
    }

    // 3. Detect Brand/Attributes from Context
    const attrs = {};
    const brandAttr = storeContext.ATTRIBUTES.brand;
    if (brandAttr) {
        brandAttr.predefined_values.forEach(v => {
            if (text.includes(v.label.toLowerCase())) attrs.brand = v.value;
        });
    }

    // Generic Color/Size detection (for testing)
    const commonColors = ['red', 'blue', 'green', 'black', 'white', 'gold', 'silver'];
    commonColors.forEach(c => { if (text.includes(c)) attrs.color = c; });

    if (Object.keys(attrs).length > 0) extracted.attributes = attrs;

    // 4. Detect Clauses from Context — only match whole words to avoid substrings
    const clauseWords = [];
    for (const [id, clause] of Object.entries(CLAUSES)) {
        const matches = [clause.label, ...(clause.matches || [])];
        matches.forEach(m => {
            const regex = new RegExp(`\\b${m.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
            if (regex.test(text)) {
                clauseWords.push({ word: m, clauseId: id });
            }
        });
    }
    if (clauseWords.length > 0) extracted.clause_words = clauseWords;

    // 5. Quantity & Order ID
    const qtyMatch = text.match(/\b(\d+)\s+(?:item|product|unit|bottle|pcs)\b/);
    if (qtyMatch) extracted.quantity = parseInt(qtyMatch[1]);

    const orderMatch = text.match(/order\s*#?\s*([a-z0-9]{6,10})/);
    if (orderMatch) extracted.order_id = orderMatch[1];

    // 6. Product Name: extract leftover words after stripping known entities
    // (instead of hardcoded product list that doesn't scale)
    const stopWords = new Set(['i', 'me', 'my', 'the', 'a', 'an', 'to', 'in', 'for',
        'show', 'need', 'want', 'add', 'buy', 'get', 'find', 'search', 'remove',
        'from', 'cart', 'order', 'please', 'hi', 'hello', 'hey', 'and', 'also',
        'with', 'some', 'any', 'of', 'do', 'you', 'have', 'what', 'is', 'it',
        'can', 'could', 'would', 'about', 'tell', 'contact', 'products', 'track',
        'status', 'cancel', 'update', 'change', 'set', 'compare', 'list', 'check']);
    const words = text.split(/\s+/).filter(w =>
        w.length > 1 && !stopWords.has(w) && !/^\d+$/.test(w)
    );
    // Remove category, vendor, and clause words already detected
    const detectedWords = new Set();
    if (extracted.category) {
        const cat = storeContext.CATEGORIES[extracted.category];
        if (cat) cat.label.toLowerCase().split(/\s+/).forEach(w => detectedWords.add(w));
    }
    if (extracted.vendor) {
        const v = storeContext.VENDORS[extracted.vendor];
        if (v) v.business_name.toLowerCase().split(/\s+/).forEach(w => detectedWords.add(w));
    }
    clauseWords.forEach(cw => cw.word.toLowerCase().split(/\s+/).forEach(w => detectedWords.add(w)));

    const productWords = words.filter(w => !detectedWords.has(w));
    if (productWords.length > 0) {
        const productName = productWords.join(' ');
        extracted.product_name = productName;
        extracted.products = [productName];
    }

    return JSON.stringify(extracted);
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
        if (result.resolutions && result.resolutions.length > 0) {
            console.log(`${C.dim}  Resolved:  ${C.reset}${result.resolutions.map(r => `"${r.original}" → "${r.resolved}"`).join(', ')}`);
        }
    }

    // Intents
    if (result.intents.length === 0) {
        console.log(`${C.red}${C.bold}  ✗ No intent detected${C.reset}`);
    } else {
        // Microstate Indicators
        if (result.microstate_opened) {
            console.log(`${C.yellow}${C.bold}  🔒 MICROSTATE OPENED: ${result.tools[0].reason}${C.reset}`);
        }
        if (result.microstate_fulfilled) {
            console.log(`${C.green}${C.bold}  ✅ MICROSTATE FULFILLED${C.reset}`);
        }
        if (result.microstate_reprompt) {
            console.log(`${C.yellow}${C.bold}  🔄 MICROSTATE RE-PROMPT${C.reset}`);
        }
        if (result.microstate_escalated) {
            console.log(`${C.red}${C.bold}  ⬆️ MICROSTATE ESCALATED${C.reset}`);
        }

        for (let i = 0; i < result.intents.length; i++) {
            const intent = result.intents[i];
            const label = result.isMultiIntent ? `  Intent ${i + 1}` : '  Intent';
            console.log(`${C.cyan}${C.bold}${label}: ${intent.intentName}${C.reset} ${C.dim}(score: ${intent.score?.toFixed(2) || 'N/A'})${C.reset}`);

            // Structural Diagnostic
            if (intent.parameters?._structuralTemplate) {
                console.log(`${C.magenta}${C.dim}    [Structural Match] ${intent.parameters._structuralTemplate}${C.reset}`);
            }

            // Show extracted params
            if (intent.parameters && Object.keys(intent.parameters).length > 0) {
                const paramStr = Object.entries(intent.parameters)
                    .filter(([k, v]) => v !== null && v !== undefined && !k.startsWith('_'))
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
            const color = er.success ? C.green : er.skipped ? C.yellow : C.red;
            const status = er.success ? '✓' : er.skipped ? '⊘' : '✗';
            const label = er.skipped ? ' (skipped)' : (er.ported ? ' (ported)' : '');
            console.log(`${color}${C.bold}  ${status} ${er.tool}${label}${C.reset}`);

            if (er.result && er.result.message) {
                console.log(`    ${C.white}${er.result.message}${C.reset}`);
            }

            if (er.skipped && er.skippedMessage) {
                console.log(`    ${C.yellow}${er.skippedMessage}${C.reset}`);
            }

            if (er.ported && er.portedFrom) {
                console.log(`    ${C.dim}(ported from ${er.portedFrom})${C.reset}`);
            }

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

/**
 * Build a simple, deterministic "Bot" reply from tool results.
 * This is a lightweight personality layer for the REPL only
 * (no AI calls, just formatting based on tool outputs).
 */
function buildSimpleReply(userMessage, result, executionResults = []) {
    // 1. Prefer directResponse from microstate tools (collect / disambiguate / confirm)
    const direct = executionResults.find(er => er.result && er.result.directResponse);
    if (direct && direct.result && direct.result.message) {
        return direct.result.message;
    }

    // 2. If a primary tool has a message, surface it
    const primary = executionResults[0];
    if (primary && primary.result && primary.result.message) {
        return primary.result.message;
    }

    // 3. For product-like tools, synthesize a full summary (no truncation)
    const productResult = executionResults.find(er =>
        er.result && (er.result.products || er.result.results)
    );
    const skipped = executionResults.find(er => er.skipped && er.skippedMessage);
    const skippedSuffix = skipped ? ` ${skipped.skippedMessage}` : '';

    if (productResult) {
        const prods = productResult.result.products || productResult.result.results || [];
        if (prods.length === 0) {
            return `I couldn't find anything matching "${userMessage}".${skippedSuffix}`;
        }
        const names = prods.map(p => p.name || p.title).filter(Boolean);
        if (names.length > 0) {
            return `Here are some options I found: ${names.join(', ')}.${skippedSuffix}`;
        }
    }

    // 4. Skipped message only (e.g. cart.add skipped, no product search)
    if (skipped) {
        return skipped.skippedMessage;
    }

    // 5. If we have an intent but no tools, give a minimal acknowledgement
    if (result.intents && result.intents.length > 0) {
        const top = result.intents[0];
        return `Got it, I interpreted that as "${top.intentName}".`;
    }

    // 6. Fallback
    return null;
}

async function printState() {
    const state = await stateManager.getState(TEST_SESSION_ID);
    console.log(`\n${C.cyan}── Current User State ──${C.reset}`);

    // Microstate Detail
    if (state.microstate) {
        const ms = state.microstate;
        console.log(`${C.yellow}${C.bold}  🔒 Active Microstate: ${ms.type}${C.reset}`);
        console.log(`${C.dim}     Intent: ${ms.intent}${C.reset}`);
        console.log(`${C.dim}     Messages: ${ms.contract.messagesUsed}/${ms.contract.maxMessages}${C.reset}`);
        console.log(`${C.dim}     Confidence: ${(ms.confidence * 100).toFixed(0)}%${C.reset}`);
        console.log(`${C.dim}     Params: ${JSON.stringify(ms.params)}${C.reset}`);
    } else {
        console.log(`${C.dim}  No active microstate${C.reset}`);
    }

    const results = state.product_context?.last_search?.results || [];
    console.log(`${C.dim}  Last search (legacy): "${state.product_context?.last_search?.query || 'none'}"${C.reset}`);

    // New Search Context (Phase 18)
    const sCtx = state.search_context;
    if (sCtx) {
        console.log(`${C.cyan}${C.bold}  📸 Search Context (Phase 18):${C.reset}`);
        console.log(`${C.dim}     Query:    ${sCtx.query || 'none'}${C.reset}`);
        console.log(`${C.dim}     Category: ${sCtx.category || 'none'} (${sCtx.category_id || 'none'})${C.reset}`);
        console.log(`${C.dim}     Clauses:  [${(sCtx.clauses || []).join(', ')}]${C.reset}`);
        console.log(`${C.dim}     Products: ${(sCtx.product_ids || []).length} items cached${C.reset}`);
        console.log(`${C.dim}     TTL:      ${sCtx.ttl_messages} messages${C.reset}`);
    }

    console.log(`${C.dim}  Cart items: ${state.cart?.item_count || 0}${C.reset}`);
    console.log(`${C.dim}  Viewing: ${state.product_context?.currently_viewing || 'none'}${C.reset}`);
    console.log(`${C.dim}  Verbose: ${verbose ? 'on' : 'off'}${C.reset}\n`);
}

async function initializeSession() {
    console.log(`${C.dim}Initializing REPL session...${C.reset}`);
    await stateManager.clearState(TEST_SESSION_ID);
}

// ═══════════════════════════════════════════════════
//  REPL
// ═══════════════════════════════════════════════════
async function main() {
    console.log(`
${C.bold}${C.cyan}╔═══════════════════════════════════════════════╗
║     Hybrid Intent Resolver — Phase 18 REPL     ║
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

        try {
            const start = Date.now();
            const state = await stateManager.getState(TEST_SESSION_ID);

            // Zero AI: deterministic + structural extraction only, no AI fallback
            const result = await resolveAndMap(input, state, null, storeContext);

            let executionResults = [];
            if (result.tools.length > 0) {
                // Mute tool execution for pure intent testing if needed, but keeping for now
                executionResults = await executeTools(result.tools, TEST_SESSION_ID);
            }

            const ms = Date.now() - start;

            printResult(result, executionResults);
            const reply = buildSimpleReply(input, result, executionResults);
            if (reply) {
                console.log(`${C.white}  Bot: ${reply}${C.reset}\n`);
            }
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
