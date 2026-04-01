const path = require('path');
const SemanticDataService = require('../utils/SemanticDataService');
const { ATTRIBUTES } = require('../../../../context/storeContext');

const BENCH_FILE = path.join(__dirname, 'facet_bench.json');

async function sync() {
    const service = new SemanticDataService(BENCH_FILE);
    const command = process.argv[2] || 'discover';
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
        case 'discover':
            console.log(`📊 Discovering new facets from storeContext (No AI generation)...`);
            let discoveredCount = 0;
            for (const code of Object.keys(configs)) {
                if (service.addSkeleton(code)) {
                    console.log(`✨ Discovered NEW attribute: ${code}`);
                    discoveredCount++;
                }
            }
            console.log(discoveredCount > 0 ? `✅ Added ${discoveredCount} new skeletons.` : `✨ No new attributes found.`);
            break;

        case 'force-update':
            console.log(`🔨 Force updating bench structure...`);
            let forceDiscovered = 0;
            for (const code of Object.keys(configs)) {
                if (service.addSkeleton(code)) {
                    console.log(`✨ Discovered NEW attribute: ${code}`);
                    forceDiscovered++;
                }
            }
            service.deleteGhosts(Object.keys(configs));
            console.log(forceDiscovered > 0 ? `✅ Added ${forceDiscovered} new skeletons.` : `✨ Structure up to date.`);
            break;

        case 're-generate':
            console.log(`🧹 Wiping bench and starting fresh with 0 runs...`);
            service.clearBench();
            for (const code of Object.keys(configs)) {
                service.addSkeleton(code);
            }
            console.log(`✅ Bench reset with ${Object.keys(configs).length} empty facets.`);
            break;

        case 'generate':
            if (!param || !configs[param]) {
                console.log(`❌ Invalid or missing facet code. Available codes: ${Object.keys(configs).join(', ')}`);
                break;
            }
            console.log(`🎯 Targeted generation for: ${param}`);
            await service.generateVariations(param, configs[param]);
            break;

        case 'generate-all':
            console.log(`🌍 Generating 1 run for ALL ${Object.keys(service.bench).length} facets in the bench...`);
            for (const code of Object.keys(service.bench)) {
                if (configs[code]) {
                    await service.generateVariations(code, configs[code]);
                    await new Promise(res => setTimeout(res, 1000));
                }
            }
            break;

        case 'generate-weakest':
            const weakestKeys = service.getWeakestKeys();
            if (weakestKeys.length === 0) {
                console.log(`✨ Bench is empty, nothing to generate.`);
                break;
            }
            console.log(`🏥 Prioritizing weakest facets (${weakestKeys.length} found)...`);
            for (const code of weakestKeys) {
                if (configs[code]) {
                    console.log(`   🔸 Generating for weakest: ${code}`);
                    await service.generateVariations(code, configs[code]);
                    await new Promise(res => setTimeout(res, 1000));
                } else {
                    console.log(`   ⚠️ Skipping ${code} as it is not in the active config (Ghost). Consider running force-update.`);
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
            printHelp();
    }

    console.log(`\n✨ Facet Sync Operation Complete! Average Runs: ${service.getAverageRuns()}`);
}

function printHelp() {
    console.log(`
Available commands:

--- Structural Commands (Fast - No AI calls) ---
  discover         : Finds new attributes from context and adds empty skeletons. Does not delete old ghosts. (Default)
  force-update     : Adds new empty skeletons AND deletes ghost items that no longer exist in context.
  re-generate      : DELETES the entire bench and restarts with fresh empty skeletons.

--- Generation Commands (Uses AI) ---
  generate-weakest : Finds the facet(s) with the absolute lowest run count and generates 1 run for them.
  generate <code>  : Generates 1 run specifically for the targeted facet code.
  generate-all     : Generates 1 run for EVERY facet currently in the bench.
  parity           : Automatically brings all active facets up to the average run count.
  
--- Maintenance ---
  prune            : Scans current variations and removes strongly duplicate/similar phrases.
`);
}

sync().catch(console.error);
