require('dotenv').config(); // must be first — loads DEBUG, DEBUG_REDIS_URL etc. before any module reads process.env
console.log('💎 REPL ID: ALPHA-10-SEC');
/**
 * REPL Commands:
 * :chat      - Toggle AI response generation (personality layer)
 * :buttons   - Toggle visualization of all generated buttons (IDs, labels, sources)
 * :cards     - Toggle console simulation of WhatsApp product cards
 * :images    - Toggle simulation of bare images
 * :state     - Print current user state, context, and microstate details
 * :reset     - Reset session state and conversation history
 * :verbose   - Toggle detailed pipeline trace logging
 * :filelog   - Toggle per-message debug logging to files
 * :quit      - Exit the REPL
 * 
 * .clearcart - Clear backend cart via API
 * .clearall  - Clear both state and backend cart
 */
const path = require('path');
const fs = require('fs');
const LOG_FILE = path.join(__dirname, '../debug_trace.log');
fs.writeFileSync(LOG_FILE, `=== START SESSION ${new Date().toISOString()} ===\n`);

const readline = require('readline');
const { resolveAndMap } = require('../src/services/intentResolver');
const { resolveDeterministic } = require('../src/core/deterministicResolver');
const stateManager = require('../src/state/stateManager');
const { executeTools } = require('../src/core/orchestrator');
const stack = require('../src/services/intentResolver/pipeline/stack');
const storeContext = require('../src/context/storeContext');
const { CLAUSES } = require('../src/context/clauses');
const axios = require('axios');
const { generateResponseFromTools } = require('../src/core/personalityLayer');
const { extractImages } = require('../src/utils/imageInjector');

// ═══════════════════════════════════════════════════
//  Constants & Config
// ═══════════════════════════════════════════════════
const TEST_SESSION_ID = 'repl_test_session';
const BACKEND_URL = process.env.BACKEND_API_URL || 'http://localhost:3000';
const TENANT_ID = process.env.TENANT_ID || 'cbe1df05-45ed-455a-9ce6-156b0bd45713';
let verbose = false;
let chatMode = false;
let conversationHistory = [];
let showButtons = false;
let showCards = false;
let showImages = false;

async function clearBackendCart(sessionId) {
    const headers = {
        'X-Tenant-ID': TENANT_ID,
        'Content-Type': 'application/json'
    };

    try {
        const cartRes = await axios({
            url: `${BACKEND_URL}/cart?session_id=${encodeURIComponent(sessionId)}`,
            method: 'GET',
            headers
        });

        const items = cartRes?.data?.items || [];
        let removed = 0;
        for (const item of items) {
            if (!item?.id) continue;
            await axios({
                url: `${BACKEND_URL}/cart/items/${item.id}`,
                method: 'DELETE',
                headers
            });
            removed++;
        }
        return { removed, hadItems: items.length };
    } catch (err) {
        console.error(`${C.red}  Error clearing backend cart: ${err.message}${C.reset}`);
        return { removed: 0, hadItems: 0 };
    }
}
let filePerMessage = false;
const { startRun, logDebug } = require('../src/utils/debugLogger');


// Accumulate tool executions across turns so the final stack-completion summary
// includes tools that ran during earlier microstate turns.
let accumulatedExecutionResults = [];

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

    // 2.5 If cart.add ran, surface a clear outcome
    const cartAdds = executionResults.filter(er => er && er.tool === 'cart.add');
    if (cartAdds.length > 0) {
        const successCount = cartAdds.filter(er => er.success).length;
        const failCount = cartAdds.filter(er => !er.success && !er.skipped).length;
        if (successCount > 0 && failCount === 0) {
            return `Added ${successCount} item${successCount === 1 ? '' : 's'} to your cart.`;
        }
        if (successCount > 0 && failCount > 0) {
            return `Added ${successCount} item${successCount === 1 ? '' : 's'} to your cart, but ${failCount} item${failCount === 1 ? '' : 's'} failed to add.`;
        }
        if (successCount === 0 && failCount > 0) {
            return `I couldn't add those items to your cart.`;
        }
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
        return `I found ${prods.length} products.${skippedSuffix}`;
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
    console.log(`${C.dim}  Verbose: ${verbose ? 'on' : 'off'}${C.reset}`);
    console.log(`${C.dim}  FileLog: ${filePerMessage ? 'on' : 'off'}${C.reset}\n`);
}

async function initializeSession() {
    console.log(`${C.dim}Initializing REPL session...${C.reset}`);
    await stateManager.clearState(TEST_SESSION_ID);
    accumulatedExecutionResults = [];
    conversationHistory = [];
}
// ═══════════════════════════════════════════════════
//  REPL
// ═══════════════════════════════════════════════════
async function main() {
    // Connect to Redis first — same as server.js does at startup.
    // Without this, getClient() returns null and ALL state silently falls to in-memory cache.
    const redisClient = require('../src/state/redis');
    try {
        await redisClient.initRedis();
    } catch (e) {
        console.warn(`${C.yellow}  ⚠ Redis unavailable — state will use in-memory fallback: ${e.message}${C.reset}`);
    }

    console.log(`
${C.bold}${C.cyan}╔═══════════════════════════════════════════════╗
║     Hybrid Intent Resolver — Phase 18 REPL     ║
╚═══════════════════════════════════════════════╝${C.reset}
${C.dim} Commands:
   :chat      - Toggle AI (personality)
   :buttons   - Toggle Button Visualization
   :cards     - Toggle Product Card Simulation
   :images    - Toggle Bare Image Simulation
   :state     - Print State / Microstate
   :reset     - Reset session
   :verbose   - Toggle Pipeline Trace
   :filelog   - Toggle debug_trace logs
   :quit      - Exit REPL${C.reset}
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
        if (input === ':chat') {
            chatMode = !chatMode;
            console.log(`${C.green}  ✓ Chat mode: ${chatMode ? 'on' : 'off'}${C.reset}\n`);
            rl.prompt(); return;
        }
        if (input === ':buttons') {
            showButtons = !showButtons;
            console.log(`${C.green}  ✓ Show buttons: ${showButtons ? 'on' : 'off'}${C.reset}\n`);
            rl.prompt(); return;
        }
        if (input === ':cards') {
            showCards = !showCards;
            console.log(`${C.green}  ✓ Show cards: ${showCards ? 'on' : 'off'}${C.reset}\n`);
            rl.prompt(); return;
        }
        if (input === ':images') {
            showImages = !showImages;
            console.log(`${C.green}  ✓ Show images: ${showImages ? 'on' : 'off'}${C.reset}\n`);
            rl.prompt(); return;
        }
        if (input === ':filelog') {
            filePerMessage = !filePerMessage;
            console.log(`${C.green}  ✓ FileLog (per-message logging): ${filePerMessage ? 'on' : 'off'}${C.reset}\n`);
            rl.prompt(); return;
        }
        if (input === '.clearcache' || input === '.clearcahe') {
            await stateManager.clearState(TEST_SESSION_ID);
            await stateManager.setLastTools(TEST_SESSION_ID, []);
            console.log(`${C.green}  ✓ State cache cleared!${C.reset}\n`);
            rl.prompt(); return;
        }
        if (input === '.clearcart') {
            const { removed } = await clearBackendCart(TEST_SESSION_ID);
            await stateManager.updateCart(TEST_SESSION_ID, { item_count: 0, total: 0 });
            console.log(`${C.green}  ✓ Cart cleared locally! Removed ${removed} item${removed === 1 ? '' : 's'} from API backend.${C.reset}\n`);
            rl.prompt(); return;
        }
        if (input === '.clearall') {
            const { removed } = await clearBackendCart(TEST_SESSION_ID);
            await stateManager.clearState(TEST_SESSION_ID);
            await stateManager.setLastTools(TEST_SESSION_ID, []);
            await stateManager.updateCart(TEST_SESSION_ID, { item_count: 0, total: 0 });
            console.log(`${C.green}  ✓ State + cart cleared locally! Removed ${removed} item${removed === 1 ? '' : 's'} from API backend.${C.reset}\n`);
            rl.prompt(); return;
        }

        try {
            const start = Date.now();
            let runId;
            const state = await stateManager.getState(TEST_SESSION_ID);

            if (filePerMessage) {
                runId = `req_repl_${Date.now()}`;
                startRun(runId);
                logDebug('REPL:REQUEST_RECEIVED', {
                    _desc: 'Request received — REPL simulation, start run',
                    runId,
                    sessionId: TEST_SESSION_ID,
                    message: input,
                    messageLength: input.length,
                    timestamp: new Date().toISOString()
                });

                // Dump state telemetry so visualizer has full context for this turn
                logDebug('SERVER:STATE_BEFORE', {
                    _desc: 'State retrieval — load user state from Redis/memory before processing',
                    session_id: state.session_id,
                    user_id: state.user_id,
                    current_intent: state.current_intent,
                    active_flow: state.active_flow,
                    expecting_input: state.expecting_input,
                    conversation_history: state.conversation_history,
                    conversation_summary: state.conversation_summary,
                    product_context: state.product_context,
                    reference_map: state.reference_map,
                    ordinal_list: state.ordinal_list,
                    cart: state.cart,
                    checkout: state.checkout,
                    preferences: state.preferences,
                    session: state.session,
                    microstate: state.microstate,
                    last_bot_suggestion: state.last_bot_suggestion,
                    last_tools: state.last_tools,
                    paused_context: state.paused_context,
                    created_at: state.created_at,
                    updated_at: state.updated_at,
                    version: state.version
                });
            }

            // Track conversation history for LLM
            conversationHistory.push({ role: 'user', text: input });

            // Zero AI: deterministic + structural extraction only, no AI fallback
            // We use resolveDeterministic (like server.js) so we get the DETERMINISTIC_RESOLVER log traces
            const resolverOutput = await resolveDeterministic(input, state);
            const result = resolverOutput.result || { intents: [], tools: [] };

            let executionResults = [];
            if (resolverOutput.tools.length > 0) {
                // Mute tool execution for pure intent testing if needed, but keeping for now
                executionResults = await executeTools(resolverOutput.tools, TEST_SESSION_ID);
            }

            // STACK-SCOPED SEARCH CONTEXT: if product.search ran, snapshot search_context into the stack
            const ranProductSearch = executionResults.some(tr => tr && tr.tool === 'product.search' && tr.success);
            if (ranProductSearch) {
                const sCtx = await stateManager.getSearchContext(TEST_SESSION_ID);
                const s = await stateManager.getStack(TEST_SESSION_ID);
                if (s && sCtx && Array.isArray(sCtx.product_ids) && sCtx.product_ids.length > 0) {
                    s.last_search_context = sCtx;
                    if (!Array.isArray(s.search_history)) s.search_history = [];
                    s.search_history.push({
                        ts: new Date().toISOString(),
                        intent: 'product_search',
                        product_ids_count: sCtx.product_ids.length,
                        query: sCtx.query || '',
                        category_id: sCtx.category_id || null,
                        category: sCtx.category || null
                    });
                    await stateManager.setStack(TEST_SESSION_ID, s);
                }
            }

            // Keep a running log across turns.
            accumulatedExecutionResults.push(...executionResults);

            if (filePerMessage) {
                logDebug('REPL:INTENT_RESOLVED', {
                    _desc: 'Intent resolved — deterministic pipeline output, tools selected',
                    intent: result.intents.length > 0 ? result.intents[0].intentName : 'unknown',
                    toolCount: result.tools.length,
                    toolsSelected: result.tools,
                    executionResults: executionResults
                });
            }

            const ms = Date.now() - start;

            // If a microstate is open (either just opened by resolveAndMap or already active),
            // print immediately and do NOT continue the stack in the same turn.
            const activeMicrostateAfter = await stateManager.getMicrostate(TEST_SESSION_ID);
            const microstateIsOpenNow = !!(activeMicrostateAfter || result.microstate_opened);

            if (microstateIsOpenNow) {
                // For microstates, show prompt/fulfillment info immediately.
                const consolidated = [...accumulatedExecutionResults];
                printResult(result, consolidated);
                const reply = buildSimpleReply(input, result, consolidated);
                if (reply) {
                    if (chatMode) {
                        console.log(`${C.dim}  (Deterministic reply available: "${reply}")${C.reset}`);
                    } else {
                        console.log(`${C.white}  Bot: ${reply}${C.reset}\n`);
                    }
                }
                
                if (chatMode) {
                    console.log(`${C.dim}  Generating AI personality response...${C.reset}`);
                    const aiReply = await generateResponseFromTools(input, consolidated, conversationHistory);
                    const idPattern = /([\*_]*\s*\(ID[:\s]\s*[a-z0-9-]*\)\s*[\*_]*|[\*_]*\s*\(Item:\s*[a-z0-9-]*\)\s*[\*_]*|[\*_]*\s*\(#[a-z0-9-]+\)\s*[\*_]*|[\*_]*\s*\([a-z0-9-]{8,}\)\s*[\*_]*|[\*_]*\s*#[a-z0-9-]{8,}\s*[\*_]*)/gi;
                    const sanitized = aiReply.replace(idPattern, '').replace(/\*\*(.*?)\*\*/g, '*$1*').trim();
                    console.log(`${C.white}  🤖 AI Bot: ${sanitized}${C.reset}\n`);
                    conversationHistory.push({ role: 'ai', text: sanitized });
                } else if (reply) {
                    conversationHistory.push({ role: 'ai', text: reply });
                }

                const images = extractImages(consolidated);
                if (images.length > 0) {
                    console.log(`${C.dim}  Images: [${images.join(', ')}]${C.reset}`);
                }

                console.log(`${C.dim}  ⏱ ${ms}ms${C.reset}\n`);
                rl.prompt();
                return;
            }

            // ═══════════════════════════════════════════════
            // STACK: Execute all remaining intents sequentially
            // ═══════════════════════════════════════════════
            const persistedStack = await stateManager.getStack(TEST_SESSION_ID);
            const hasPersistedStack = !!(persistedStack && persistedStack.remaining_intents && persistedStack.remaining_intents.length > 0);
            console.log(`${C.dim}[STACK DEBUG] Checking continuation | stack_active: ${result.stack_active} | microstate_fulfilled: ${result.microstate_fulfilled} | persisted: ${hasPersistedStack} | microstate_open: ${microstateIsOpenNow}${C.reset}`);

            // In REPL mode, always trust persisted stack state.
            // The pipeline can return stack_active:false in some edge paths (e.g. microstate TTL expiry)
            // even though stack still exists in state.
            if (!microstateIsOpenNow && (result.stack_active || result.microstate_fulfilled || hasPersistedStack)) {
                let stackData = persistedStack;

                console.log(`${C.cyan}[STACK DEBUG] Initial state | remaining: ${stackData?.remaining_intents?.length || 0} | executed: ${stackData?.executed_intents?.length || 0} | index: ${stackData?.current_intent_index}${C.reset}`);

                let pausedForMicrostate = false;

                while (stackData && stackData.remaining_intents && stackData.remaining_intents.length > 0) {
                    console.log(`${C.yellow}📚 Executing remaining stack intents: ${stackData.remaining_intents.length}${C.reset}`);

                    // Show pending intents
                    stackData.remaining_intents.forEach((intent, i) => {
                        const params = JSON.stringify(intent.parameters).slice(0, 60);
                        console.log(`${C.dim}  [${i}] ${intent.intentName}: ${params}...${C.reset}`);
                    });

                    // Re-resolve ordinals with fresh search_context before each intent
                    console.log(`${C.magenta}[STACK DEBUG] Re-resolving ordinals...${C.reset}`);
                    await stack.reResolveOrdinalsForRemainingIntents(stackData.remaining_intents, state, storeContext);

                    // Get next intent
                    const nextIntent = stackData.remaining_intents[0];

                    // ═══════════════════════════════════════════════
                    // Check if this intent needs a microstate
                    // ═══════════════════════════════════════════════
                    const microstateRegistry = require('../src/services/intentResolver/config/microstateRegistry');
                    const triggered = microstateRegistry.checkTriggers(nextIntent.intentName, nextIntent.parameters || {}, []);

                    console.log(`${C.dim}[STACK DEBUG] Microstate check: ${nextIntent.intentName} | triggered: ${triggered ? 'YES' : 'NO'}${C.reset}`);
                    if (triggered) {
                        console.log(`${C.dim}[STACK DEBUG]   trigger: ${triggered.triggerName}${C.reset}`);
                    }

                    if (triggered) {
                        // Open microstate and pause stack execution
                        console.log(`${C.yellow}[STACK DEBUG] Microstate needed for: ${nextIntent.intentName} → ${triggered.triggerName}${C.reset}`);

                        const microstate = triggered.buildMicrostate(nextIntent);
                        await stateManager.setMicrostate(TEST_SESSION_ID, microstate);

                        // Update stack - intent stays at front of remaining (not executed yet)
                        // Just save current state, don't advance
                        await stateManager.setStack(TEST_SESSION_ID, stackData);

                        // Show the microstate prompt
                        const promptText = triggered.triggerDef.prompt?.text || `Please provide ${triggered.triggerName}`;
                        console.log(`\n${C.yellow}🔒 MICROSTATE OPENED: ${triggered.triggerName}${C.reset}`);
                        console.log(`${C.yellow}   Intent: ${nextIntent.intentName}${C.reset}`);
                        console.log(`${C.white}  Bot: ${promptText}${C.reset}\n`);

                        // Break out to wait for user input
                        pausedForMicrostate = true;
                        break;
                    }

                    // No microstate needed - execute normally
                    const toolMapper = require('../src/services/intentResolver/pipeline/toolMapper');
                    const nextTools = toolMapper.mapToTools([{
                        intentName: nextIntent.intentName,
                        parameters: nextIntent.parameters || {},
                        _ported_from: nextIntent._ported_from
                    }]);

                    console.log(`${C.yellow}📚 Executing: ${nextIntent.intentName}${C.reset}`);
                    const nextExecutionResults = await executeTools(nextTools, TEST_SESSION_ID);
                    executionResults.push(...nextExecutionResults);
                    accumulatedExecutionResults.push(...nextExecutionResults);

                    // STACK-SCOPED SEARCH CONTEXT: if product.search ran in stack, snapshot search_context into stack
                    const ranStackProductSearch = nextExecutionResults.some(tr => tr && tr.tool === 'product.search' && tr.success);
                    if (ranStackProductSearch) {
                        const sCtx = await stateManager.getSearchContext(TEST_SESSION_ID);
                        if (sCtx && Array.isArray(sCtx.product_ids) && sCtx.product_ids.length > 0) {
                            stackData.last_search_context = sCtx;
                            if (!Array.isArray(stackData.search_history)) stackData.search_history = [];
                            stackData.search_history.push({
                                ts: new Date().toISOString(),
                                intent: nextIntent.intentName,
                                product_ids_count: sCtx.product_ids.length,
                                query: sCtx.query || '',
                                category_id: sCtx.category_id || null,
                                category: sCtx.category || null
                            });
                            await stateManager.setStack(TEST_SESSION_ID, stackData);
                        }
                    }

                    // Update stack progress - ONLY advance if we actually executed
                    stackData.executed_intents.push(nextIntent);
                    stackData.remaining_intents = stackData.remaining_intents.slice(1);
                    stackData.current_intent_index++;

                    if (stackData.remaining_intents.length === 0) {
                        await stateManager.clearStack(TEST_SESSION_ID);
                        console.log(`${C.green}📚 Stack complete!${C.reset}`);
                    } else {
                        await stateManager.setStack(TEST_SESSION_ID, stackData);
                    }

                    // Refresh stack data for next iteration
                    stackData = await stateManager.getStack(TEST_SESSION_ID);
                }

                // If we paused due to opening a microstate, do not print any further synthesized reply.
                // The microstate prompt above is the correct next output.
                if (pausedForMicrostate) {
                    rl.prompt();
                    return;
                }
            }

            // End-of-turn consolidated output (old behavior):
            // print a single summary that includes EVERY tool run (initial + stack),
            // then print the synthesized Bot reply.
            const consolidated = [...accumulatedExecutionResults];
            printResult(result, consolidated);
            const reply = buildSimpleReply(input, result, consolidated);
            
            if (reply) {
                if (chatMode) {
                    console.log(`${C.dim}  (Deterministic reply available: "${reply}")${C.reset}`);
                } else {
                    console.log(`${C.white}  Bot: ${reply}${C.reset}\n`);
                }
            }

            if (chatMode) {
                console.log(`${C.dim}  Generating AI personality response...${C.reset}`);
                const aiReply = await generateResponseFromTools(input, consolidated, conversationHistory);
                const idPattern = /([\*_]*\s*\(ID[:\s]\s*[a-z0-9-]*\)\s*[\*_]*|[\*_]*\s*\(Item:\s*[a-z0-9-]*\)\s*[\*_]*|[\*_]*\s*\(#[a-z0-9-]+\)\s*[\*_]*|[\*_]*\s*\([a-z0-9-]{8,}\)\s*[\*_]*|[\*_]*\s*#[a-z0-9-]{8,}\s*[\*_]*)/gi;
                const sanitized = aiReply.replace(idPattern, '').replace(/\*\*(.*?)\*\*/g, '*$1*').trim();
                console.log(`${C.white}  🤖 AI Bot: ${sanitized}${C.reset}\n`);
                conversationHistory.push({ role: 'ai', text: sanitized });
            } else if (reply) {
                conversationHistory.push({ role: 'ai', text: reply });
            }

            const images = extractImages(consolidated);
            if (images.length > 0 && !showImages && !showCards) {
                console.log(`${C.dim}  Images: [${images.join(', ')}]${C.reset}`);
            }

            // ═══════════════════════════════════════════════
            //  Visualization Overlays (:buttons, :cards, :images)
            // ═══════════════════════════════════════════════
            
            // 1. :buttons - format all buttons from all tools
            if (showButtons) {
                const allButtons = [];
                consolidated.forEach(er => {
                    const btns = er.result?.whatsapp?.buttons || [];
                    btns.forEach(b => allButtons.push({ ...b, source: er.tool }));
                    
                    const cardPayload = er.result?.whatsapp_product_cards;
                    if (cardPayload?.cards) {
                        cardPayload.cards.forEach(card => {
                            if (card.buttons) {
                                card.buttons.forEach(b => allButtons.push({ ...b, source: `${er.tool} (card)` }));
                            }
                        });
                    }
                });

                if (allButtons.length > 0) {
                    console.log(`${C.cyan}${C.bold}  🔳 Buttons Detected:${C.reset}`);
                    allButtons.forEach((b, idx) => {
                        console.log(`    [button ${idx + 1}]: label: "${C.bold}${b.title}${C.reset}", id: ${C.dim}${b.id}${C.reset} -- source: ${b.source}, priority: ${b.priority || 'N/A'}`);
                    });
                }
            }

            // 2. :cards - format product cards
            if (showCards) {
                const allCards = [];
                consolidated.forEach(er => {
                    const cardPayload = er.result?.whatsapp_product_cards;
                    if (cardPayload?.cards) {
                        cardPayload.cards.forEach(card => allCards.push({ ...card, source: er.tool }));
                    }
                });

                if (allCards.length > 0) {
                    console.log(`${C.cyan}${C.bold}  🎴 Product Cards Simulation:${C.reset}`);
                    allCards.forEach((card, idx) => {
                        console.log(`${C.dim}    ┌───────────────────────────────────┐${C.reset}`);
                        console.log(`    ${C.magenta}[product image]${C.reset}`);
                        console.log(`    ${C.bold}${card.header || 'Product'}${C.reset}`);
                        console.log(`    ${C.white}${card.body || ''}${C.reset}`);
                        if (card.footer) console.log(`    ${C.dim}${card.footer}${C.reset}`);
                        if (card.buttons) {
                            card.buttons.forEach(b => {
                                console.log(`    ${C.cyan}[button]: ${b.title}${C.reset} (${b.id})`);
                            });
                        }
                        console.log(`${C.dim}    └───────────────────────────────────┘${C.reset}`);
                    });
                }
            }

            // 3. :images - format bare images
            if (showImages) {
                const images = extractImages(consolidated);
                if (images.length > 0) {
                    console.log(`${C.cyan}${C.bold}  🖼️ Bare Images Simulation:${C.reset}`);
                    images.forEach((img, idx) => {
                        console.log(`    [product image - ${img}]`);
                    });
                }
            }

            console.log(`${C.dim}  ⏱ ${ms}ms${C.reset}\n`);

            // If stack is cleared and no microstate remains, reset accumulator for next interaction.
            const endMicrostate = await stateManager.getMicrostate(TEST_SESSION_ID);
            const endStack = await stateManager.getStack(TEST_SESSION_ID);
            const stackIsGone = !(endStack && endStack.remaining_intents && endStack.remaining_intents.length > 0);
            if (!endMicrostate && stackIsGone) {
                accumulatedExecutionResults = [];
            }
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
