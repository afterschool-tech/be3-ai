const path = require('path');
const SemanticDataService = require('../utils/SemanticDataService');
const { ATTRIBUTES } = require('../../../../context/storeContext');

const BENCH_FILE = path.join(__dirname, 'facet_bench.json');

async function sync() {
    const service = new SemanticDataService(BENCH_FILE);
    const command = process.argv[2] || 'update';
    const param = process.argv[3];

    console.log(`🚀 [Facets] Starting Semantic Sync (Mode: ${command})...`);

    // Prepare Facet Configs from context
    const configs = {};
    for (const [code, attr] of Object.entries(ATTRIBUTES)) {
        configs[code] = {
            type: 'Attribute Facet',
            description: `The attribute "${attr.label}" (Code: ${code})`,
            keywords: [attr.label, code]
        };
    }

    switch (command) {
        case 'update':
            console.log(`📊 Checking for new attributes from storeContext...`);
            let newCount = 0;
            for (const code of Object.keys(configs)) {
                if (!service.bench[code]) {
                    console.log(`✨ Discovered NEW attribute: ${code}`);
                    await service.generateVariations(code, configs[code]);
                    newCount++;
                    await new Promise(res => setTimeout(res, 1000));
                }
            }
            console.log(newCount > 0 ? `✅ Added ${newCount} new attributes.` : `✨ All attributes already present in bench.`);
            break;

        case 'add-variations':
            const runsToAdd = parseInt(param) || 1;
            console.log(`📦 Adding ${runsToAdd} runs to ALL ${Object.keys(configs).length} attributes...`);
            for (let r = 0; r < runsToAdd; r++) {
                for (const code of Object.keys(configs)) {
                    await service.generateVariations(code, configs[code]);
                    await new Promise(res => setTimeout(res, 1000));
                }
            }
            break;

        case 'parity':
            const avg = service.getAverageRuns();
            console.log(`🔄 Bringing all facets up to parity (Target: ${avg} runs)...`);
            await service.syncAll(configs, avg);
            break;

        case 'prune':
            console.log(`🧹 Pruning repetitions from facet bench...`);
            await service.pruneRepetitions(0.9); // Strict pruning for facets
            break;

        default:
            console.log(`❌ Unknown command: ${command}`);
            console.log(`Available commands: update, add-variations [count], parity, prune`);
    }

    console.log(`\n✨ Facet Sync Operation Complete! Average Runs: ${service.getAverageRuns()}`);
}

sync().catch(console.error);
