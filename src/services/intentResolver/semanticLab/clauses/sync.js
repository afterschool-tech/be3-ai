/**
 * CLAUSE SYNC SCRIPT
 * Dynamically fetches attributes from clauses.js and manages their variations.
 * Usage: node src/services/intentResolver/semanticLab/clauses/sync.js [runs_to_add]
 */
const path = require('path');
const SemanticDataService = require('../utils/SemanticDataService');
const { CLAUSES } = require('../../../../context/clauses');

const BENCH_FILE = path.join(__dirname, 'clause_bench.json');

async function sync() {
    const service = new SemanticDataService(BENCH_FILE);
    const runsToAdd = parseInt(process.argv[2]) || 1;

    console.log(`🚀 [Clauses] Starting Semantic Sync (Auto-Discovery Mode)...`);

    // 1. Prepare Clause Configs from context
    const configs = {};
    for (const [id, clause] of Object.entries(CLAUSES)) {
        configs[id] = {
            type: 'Attribute Clause',
            description: `Matches attribute "${clause.attribute}" with label "${clause.label}"`,
            keywords: [...(clause.matches || []), clause.label]
        };
    }

    console.log(`📊 Discovered ${Object.keys(configs).length} clauses from storeContext.`);

    // 2. Sync Parity for new/behind clauses
    const avg = service.getAverageRuns();
    if (avg > 0) {
        await service.syncAll(configs, avg);
    }

    // 3. Add new runs for everyone
    if (runsToAdd > 0) {
        console.log(`\n📦 Adding ${runsToAdd} runs to all discovered clauses...`);
        for (let r = 0; r < runsToAdd; r++) {
            for (const id of Object.keys(configs)) {
                await service.generateVariations(id, configs[id]);
                await new Promise(res => setTimeout(res, 1000));
            }
        }
    }

    console.log(`\n✨ Clause Sync Complete! Average Runs: ${service.getAverageRuns()}`);
}

sync().catch(console.error);
