/**
 * JOINT SYNC SCRIPT
 * Orchestrates all per-intent sync operations and merges results into joint_bench.json.
 * 
 * PARITY-FIRST LOGIC:
 *   1. Scan all intents → find MAX runs across all benches
 *   2. Catch up lagging intents to the MAX (e.g. intent at 2 runs catches up to 5)
 *   3. Then add [runs_to_add] new runs uniformly to everyone
 * 
 * Usage: node src/services/intentResolver/semanticLab/intents/joint_sync.js [runs_to_add]
 */
const fs = require('fs');
const path = require('path');
const SemanticDataService = require('../utils/SemanticDataService');
const intentRegistry = require('../../config/intentRegistry');

const INTENTS_DIR = __dirname;
const JOINT_BENCH = path.join(INTENTS_DIR, 'joint_bench.json');
const RATE_LIMIT_DELAY = 8000;    // 8s between AI calls
const BATCH_COOLDOWN = 30000;     // 30s pause every 5 calls
const BATCH_SIZE = 5;

/**
 * Merge all per-intent bench.json files into one joint_bench.json
 */
function mergeAllBenches() {
    const merged = {};
    const entries = fs.readdirSync(INTENTS_DIR, { withFileTypes: true });

    for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const benchPath = path.join(INTENTS_DIR, entry.name, 'bench.json');
        if (!fs.existsSync(benchPath)) continue;

        try {
            const data = JSON.parse(fs.readFileSync(benchPath, 'utf8'));
            Object.assign(merged, data);
        } catch (e) {
            console.warn(`⚠️  Failed to read ${entry.name}/bench.json: ${e.message}`);
        }
    }

    fs.writeFileSync(JOINT_BENCH, JSON.stringify(merged, null, 2));
    console.log(`📦 Joint bench merged: ${Object.keys(merged).length} intents → joint_bench.json`);
    return merged;
}

/**
 * Get the current run count for an intent from its bench.json
 */
function getIntentRuns(intentName) {
    const benchPath = path.join(INTENTS_DIR, intentName, 'bench.json');
    if (!fs.existsSync(benchPath)) return 0;

    try {
        const data = JSON.parse(fs.readFileSync(benchPath, 'utf8'));
        return data[intentName]?.metadata?.runs || 0;
    } catch {
        return 0;
    }
}

/**
 * Run a single generation for one intent (with rate limiting)
 */
async function generateForIntent(intentName, intent, apiCallCount) {
    const intentDir = path.join(INTENTS_DIR, intentName);
    const benchPath = path.join(intentDir, 'bench.json');

    // Create folder + bench if missing
    if (!fs.existsSync(intentDir)) fs.mkdirSync(intentDir, { recursive: true });
    if (!fs.existsSync(benchPath)) fs.writeFileSync(benchPath, JSON.stringify({}, null, 2));

    const service = new SemanticDataService(benchPath);
    const config = {
        type: 'Intent',
        description: intent.description || `${intentName} intent`,
        keywords: [...(intent.keywords || []), ...(intent.synonyms || [])]
    };

    // Custom prompt support
    const promptPath = path.join(intentDir, 'prompt.txt');
    if (fs.existsSync(promptPath)) {
        config.customPrompt = fs.readFileSync(promptPath, 'utf8');
    }

    await service.generateVariations(intentName, config);

    // Rate limiting
    console.log(`  ⏳ Cooldown ${RATE_LIMIT_DELAY / 1000}s...`);
    await new Promise(res => setTimeout(res, RATE_LIMIT_DELAY));

    // Batch cooldown
    if (apiCallCount % BATCH_SIZE === 0) {
        console.log(`\n🧊 Batch cooldown (${BATCH_COOLDOWN / 1000}s) after ${apiCallCount} API calls...\n`);
        await new Promise(res => setTimeout(res, BATCH_COOLDOWN));
    }
}

async function sync() {
    const runsToAdd = parseInt(process.argv[2]) || 1;
    const targetIntent = process.argv[3];
    const intents = intentRegistry.getAll();
    const intentNames = targetIntent ? [targetIntent] : Object.keys(intents);

    if (targetIntent && !intents[targetIntent]) {
        console.error(`❌ Intent "${targetIntent}" not found in registry.`);
        process.exit(1);
    }

    console.log(`🚀 [Joint Sync] ${intentNames.length} intents, ${runsToAdd} new runs requested.\n`);

    // ── PHASE 1: SCAN ──
    // Find the global max runs across all intents (even if syncing target)
    const runMap = {};
    let maxRuns = 0;
    const allIntents = Object.keys(intents);

    for (const name of allIntents) {
        const runs = getIntentRuns(name);
        runMap[name] = runs;
        maxRuns = Math.max(maxRuns, runs);
    }

    console.log(`📊 Global Max Runs: ${maxRuns}`);
    console.log(`   Intents at max: ${intentNames.filter(n => runMap[n] === maxRuns).length}`);
    console.log(`   Intents behind: ${intentNames.filter(n => runMap[n] < maxRuns).length}\n`);

    let apiCallCount = 0;

    // ── PHASE 2: PARITY CATCH-UP ──
    // Bring all lagging intents up to the current max
    const lagging = intentNames.filter(n => runMap[n] < maxRuns);

    if (lagging.length > 0) {
        console.log(`🔄 [Parity] Catching up ${lagging.length} intents to ${maxRuns} runs...\n`);

        for (const name of lagging) {
            const behind = maxRuns - runMap[name];
            console.log(`  📂 ${name}: ${runMap[name]} → ${maxRuns} (${behind} runs needed)`);

            for (let i = 0; i < behind; i++) {
                apiCallCount++;
                console.log(`     Run ${i + 1}/${behind}...`);
                await generateForIntent(name, intents[name], apiCallCount);
            }
        }

        console.log(`\n✅ Parity achieved! All intents now at ${maxRuns} runs.\n`);
    } else {
        console.log(`✅ All intents already at parity (${maxRuns} runs).\n`);
    }

    // ── PHASE 3: NEW RUNS ──
    // Add runsToAdd to every intent
    console.log(`📦 Adding ${runsToAdd} new run(s) to all ${intentNames.length} intents...\n`);

    for (let r = 0; r < runsToAdd; r++) {
        console.log(`── Round ${r + 1}/${runsToAdd} ──`);

        for (const name of intentNames) {
            apiCallCount++;
            console.log(`  📂 [${name}]`);
            await generateForIntent(name, intents[name], apiCallCount);
        }
    }

    // ── MERGE ──
    console.log(`\n🔗 Merging all benches...`);
    mergeAllBenches();

    console.log(`\n✨ Joint Sync Complete! All intents now at ${maxRuns + runsToAdd} runs.`);
}

// Allow mergeAllBenches to be called standalone
if (require.main === module) {
    sync().catch(console.error);
}

module.exports = { mergeAllBenches };
