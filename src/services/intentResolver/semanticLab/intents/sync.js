/**
 * INTENT SYNC SCRIPT
 * Manages semantic variations for all intents in intentRegistry.
 * Usage: node src/services/intentResolver/semanticLab/intents/sync.js [runs_to_add]
 */
const path = require('path');
const SemanticDataService = require('../utils/SemanticDataService');
const intentRegistry = require('../../config/intentRegistry');

const BENCH_FILE = path.join(__dirname, 'intent_bench.json');

async function sync() {
    const service = new SemanticDataService(BENCH_FILE);
    const runsToAdd = parseInt(process.argv[2]) || 1;

    console.log(`🚀 [Intents] Starting Semantic Sync...`);
    const intents = intentRegistry.getAll();
    const configs = {};

    for (const [name, intent] of Object.entries(intents)) {
        configs[name] = {
            type: 'Intent',
            description: intent.description,
            keywords: [...(intent.keywords || []), ...(intent.synonyms || [])]
        };
    }

    // 1. Sync Parity for new/behind intents
    const avg = service.getAverageRuns();
    if (avg > 0) await service.syncAll(configs, avg);

    // 2. Add new runs
    console.log(`\n📦 Adding ${runsToAdd} runs to ${Object.keys(configs).length} intents...`);
    for (let r = 0; r < runsToAdd; r++) {
        for (const name of Object.keys(configs)) {
            await service.generateVariations(name, configs[name]);
            await new Promise(res => setTimeout(res, 1000));
        }
    }
    console.log(`\n✨ Intent Sync Complete! Average Runs: ${service.getAverageRuns()}`);
}

sync().catch(console.error);
