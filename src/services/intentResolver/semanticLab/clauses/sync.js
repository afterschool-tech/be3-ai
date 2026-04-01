const path = require('path');
const SemanticDataService = require('../utils/SemanticDataService');
const { CLAUSES } = require('../../../../context/clauses');

const BENCH_FILE = path.join(__dirname, 'clause_bench.json');

async function sync() {
    const service = new SemanticDataService(BENCH_FILE);
    const command = process.argv[2] || 'discover';
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
        case 'discover':
            console.log(`📊 Discovering new clauses from storeContext (No AI generation)...`);
            let discoveredCount = 0;
            for (const id of Object.keys(configs)) {
                if (service.addSkeleton(id)) {
                    console.log(`✨ Discovered NEW clause: ${id}`);
                    discoveredCount++;
                }
            }
            console.log(discoveredCount > 0 ? `✅ Added ${discoveredCount} new skeletons.` : `✨ No new clauses found.`);
            break;

        case 'force-update':
            console.log(`🔨 Force updating bench structure...`);
            let forceDiscovered = 0;
            for (const id of Object.keys(configs)) {
                if (service.addSkeleton(id)) {
                    console.log(`✨ Discovered NEW clause: ${id}`);
                    forceDiscovered++;
                }
            }
            service.deleteGhosts(Object.keys(configs));
            console.log(forceDiscovered > 0 ? `✅ Added ${forceDiscovered} new skeletons.` : `✨ Structure up to date.`);
            break;

        case 're-generate':
            console.log(`🧹 Wiping bench and starting fresh with 0 runs...`);
            service.clearBench();
            for (const id of Object.keys(configs)) {
                service.addSkeleton(id);
            }
            console.log(`✅ Bench reset with ${Object.keys(configs).length} empty clauses.`);
            break;

        case 'generate':
            if (!param || !configs[param]) {
                console.log(`❌ Invalid or missing clause ID. Available IDs: ${Object.keys(configs).join(', ')}`);
                break;
            }
            console.log(`🎯 Targeted generation for: ${param}`);
            await service.generateVariations(param, configs[param]);
            break;

        case 'generate-all':
            console.log(`🌍 Generating 1 run for ALL ${Object.keys(service.bench).length} clauses in the bench...`);
            for (const id of Object.keys(service.bench)) {
                if (configs[id]) {
                    await service.generateVariations(id, configs[id]);
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
            console.log(`🏥 Prioritizing weakest clauses (${weakestKeys.length} found)...`);
            for (const id of weakestKeys) {
                if (configs[id]) {
                    console.log(`   🔸 Generating for weakest: ${id}`);
                    await service.generateVariations(id, configs[id]);
                    await new Promise(res => setTimeout(res, 1000));
                } else {
                    console.log(`   ⚠️ Skipping ${id} as it is not in the active config (Ghost). Consider running force-update.`);
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
            printHelp();
    }

    console.log(`\n✨ Clause Sync Operation Complete! Average Runs: ${service.getAverageRuns()}`);
}

function printHelp() {
    console.log(`
Available commands:

--- Structural Commands (Fast - No AI calls) ---
  discover         : Finds new clauses from context and adds empty skeletons. Does not delete old ghosts. (Default)
  force-update     : Adds new empty skeletons AND deletes ghost items that no longer exist in context.
  re-generate      : DELETES the entire bench and restarts with fresh empty skeletons.

--- Generation Commands (Uses AI) ---
  generate-weakest : Finds the clause(s) with the absolute lowest run count and generates 1 run for them.
  generate <id>    : Generates 1 run specifically for the targeted clause ID.
  generate-all     : Generates 1 run for EVERY clause currently in the bench.
  parity           : Automatically brings all active clauses up to the average run count.
  
--- Maintenance ---
  prune            : Scans current variations and removes strongly duplicate/similar phrases.
`);
}

sync().catch(console.error);
