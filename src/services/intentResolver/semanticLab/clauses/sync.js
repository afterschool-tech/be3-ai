const path = require('path');
const SemanticDataService = require('../utils/SemanticDataService');
const { CLAUSES } = require('../../../../context/clauses');

const BENCH_FILE = path.join(__dirname, 'clause_bench.json');

async function sync() {
    const service = new SemanticDataService(BENCH_FILE);
    const command = process.argv[2] || 'update';
    const param = process.argv[3];

    console.log(`🚀 [Clauses] Starting Semantic Sync (Mode: ${command})...`);

    // Prepare Clause Configs from context
    const configs = {};
    for (const [id, clause] of Object.entries(CLAUSES)) {
        configs[id] = {
            type: 'Attribute Clause',
            description: `Matches attribute "${clause.attribute}" with label "${clause.label}"`,
            keywords: [...(clause.matches || []), clause.label]
        };
    }

    switch (command) {
        case 'update':
            console.log(`📊 Checking for new clauses from storeContext...`);
            let newCount = 0;
            for (const id of Object.keys(configs)) {
                if (!service.bench[id]) {
                    console.log(`✨ Discovered NEW clause: ${id}`);
                    await service.generateVariations(id, configs[id]);
                    newCount++;
                    await new Promise(res => setTimeout(res, 1000));
                }
            }
            console.log(newCount > 0 ? `✅ Added ${newCount} new clauses.` : `✨ All clauses already present in bench.`);
            break;

        case 'add-variations':
            const runsToAdd = parseInt(param) || 1;
            console.log(`📦 Adding ${runsToAdd} runs to ALL ${Object.keys(configs).length} clauses...`);
            for (let r = 0; r < runsToAdd; r++) {
                for (const id of Object.keys(configs)) {
                    await service.generateVariations(id, configs[id]);
                    await new Promise(res => setTimeout(res, 1000));
                }
            }
            break;

        case 'parity':
            const avg = service.getAverageRuns();
            console.log(`🔄 Bringing all clauses up to parity (Target: ${avg} runs)...`);
            await service.syncAll(configs, avg);
            break;

        case 'prune':
            console.log(`🧹 Pruning repetitions from clause bench...`);
            await service.pruneRepetitions(0.85);
            break;

        default:
            console.log(`❌ Unknown command: ${command}`);
            console.log(`Available commands: update, add-variations [count], parity, prune`);
    }

    console.log(`\n✨ Clause Sync Operation Complete! Average Runs: ${service.getAverageRuns()}`);
}

sync().catch(console.error);
