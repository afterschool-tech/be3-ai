/**
 * Semantic Intent Data Generator (Service-Powered)
 * Leverages SemanticDataService to manage variations with run-tracking.
 */
const path = require('path');
require('dotenv').config();

const intentRegistry = require('../src/services/intentResolver/config/intentRegistry');
const SemanticDataService = require('../src/services/intentResolver/services/semanticDataService');

const OUTPUT_FILE = path.join(__dirname, '../src/services/intentResolver/config/intent_bench.json');
const RUNS_TO_ADD = 2; // Add 2 more runs to everything per script execution

async function generateData() {
    const service = new SemanticDataService(OUTPUT_FILE);
    const intents = intentRegistry.getAll();
    const intentNames = Object.keys(intents);

    console.log(`🚀 Starting Semantic Data Generation (Service Mode)`);
    console.log(`📊 Bench currently at average ${service.getAverageRuns()} runs per intent.`);

    // 1. Prepare Configs for the service
    const configs = {};
    for (const name of intentNames) {
        configs[name] = {
            type: 'Intent',
            description: intents[name].description,
            keywords: [...intents[name].keywords, ...intents[name].synonyms]
        };
    }

    // 2. PARITY SYNC: Catch up any NEW intents that have 0 runs
    const avgRuns = service.getAverageRuns();
    if (avgRuns > 0) {
        await service.syncAll(configs, avgRuns);
    }

    // 3. REGULAR BATCH UPDATE: Increment runs for everyone
    console.log(`\n📦 [Batch] Adding ${RUNS_TO_ADD} new runs to all intents...`);
    for (let r = 0; r < RUNS_TO_ADD; r++) {
        for (const name of intentNames) {
            await service.generateVariations(name, configs[name]);
            // Small internal delay for rate limiting
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }

    console.log(`\n✨ Done! Final bench size: ${Object.keys(service.bench).length} intent clusters.`);
    console.log(`📉 Average runs now: ${service.getAverageRuns()}`);
}

generateData().catch(console.error);
