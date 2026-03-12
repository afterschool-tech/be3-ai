/**
 * Pipeline Flavor Comparison REPL
 * Uses the ACTUAL intentResolver pipeline to compare:
 * FLAVOR 1: Deterministic Only (Stage 0.5 Bypassed)
 * FLAVOR 2: Hybrid (Stage 0.5 Transformer Enabled)
 */

const path = require('path');
const readline = require('readline');
const { resolveDeterministic } = require('../src/core/deterministicResolver');
const stateManager = require('../src/state/stateManager');

// Configuration
const TEST_SESSION_ID = 'flavor_comparison_session';

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
 * Extracts entities of interest for comparison display
 */
function getEntities(result) {
    // Entities are typically in result.intents[0].parameters or result.entities (if we exported them)
    // In our pipeline, results.resolutions and parameters are the best indicators.
    const intent = result.intents?.[0] || {};
    const params = intent.parameters || {};

    // Check if any of our "Rebound" or "Injected" signals are present
    const isRebound = params.facet_target_active === true;

    return {
        intent: intent.intentName || 'unknown',
        score: intent.score || 0,
        params: params,
        isRebound
    };
}

function printFlavorResult(label, result, color) {
    const data = getEntities(result);
    console.log(`${C.bold}${color}─── ${label} ───${C.reset}`);
    console.log(`${C.cyan}[Intent]${C.reset} ${data.intent} ${C.dim}(score: ${data.score.toFixed(2)})${C.reset}`);

    console.log(`${C.yellow}[Parameters]${C.reset}`);
    const filteredParams = Object.entries(data.params)
        .filter(([k, v]) => v !== null && !k.startsWith('_'))
        .map(([k, v]) => `  • ${C.bold}${k}${C.reset}: ${JSON.stringify(v)}`);

    if (filteredParams.length === 0) console.log('  None');
    else filteredParams.forEach(p => console.log(p));

    if (data.isRebound) {
        console.log(`${C.green}${C.bold}  ✨ Contextual Rebound Active${C.reset}`);
    }
    console.log('');
}

async function main() {
    console.log(`${C.bold}${C.white}╔═══════════════════════════════════════════════╗`);
    console.log(`║     Official Pipeline Flavor Comparison       ║`);
    console.log(`╚═══════════════════════════════════════════════╝${C.reset}\n`);

    await stateManager.clearState(TEST_SESSION_ID);

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

        console.log(`\n${C.dim}Processing query through full pipeline...${C.reset}\n`);

        try {
            // we need to get fresh state for each run or at least make sure they don't pollute
            const baseState = await stateManager.getState(TEST_SESSION_ID);

            // 1. Run Flavor 1 (Deterministic Only)
            const stateFlavor1 = { ...baseState, skipTransformer: true };
            const output1 = await resolveDeterministic(text, stateFlavor1);
            printFlavorResult("FLAVOR 1: Deterministic Only", output1.result, C.blue);

            // 2. Run Flavor 2 (Hybrid)
            const stateFlavor2 = { ...baseState, skipTransformer: false };
            const output2 = await resolveDeterministic(text, stateFlavor2);
            printFlavorResult("FLAVOR 2: Hybrid (Transformer Enabled)", output2.result, C.magenta);

            // Highlight difference in entities
            const p1 = JSON.stringify(Object.fromEntries(Object.entries(output1.result.intents?.[0]?.parameters || {}).filter(([k]) => !k.startsWith('_'))));
            const p2 = JSON.stringify(Object.fromEntries(Object.entries(output2.result.intents?.[0]?.parameters || {}).filter(([k]) => !k.startsWith('_'))));

            if (p1 !== p2) {
                console.log(`${C.bold}${C.green}✨ HYBRID ADVANTAGE DETECTED${C.reset}`);
                console.log(`${C.dim}Parameters evolved based on semantic context.${C.reset}\n`);
            } else {
                console.log(`${C.dim}Behavior remains identical (Strong Deterministic Match)${C.reset}\n`);
            }

        } catch (err) {
            console.error(`${C.red}Pipeline Error: ${err.message}${C.reset}`);
            console.error(err.stack);
        }

        rl.prompt();
    });
}

main();
