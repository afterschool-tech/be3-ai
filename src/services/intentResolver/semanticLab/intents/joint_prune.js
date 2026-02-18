/**
 * JOINT PRUNE SCRIPT
 * Prunes repetitions within each per-intent bench AND across the joint bench.
 * 
 * Usage: node src/services/intentResolver/semanticLab/intents/joint_prune.js [threshold]
 * 
 * Two-pass pruning:
 * 1. INTRA-INTENT: Prune duplicates within each intent's own bench.json
 * 2. CROSS-INTENT: Prune overlaps where the SAME variation appears in multiple intents.
 */
const fs = require('fs');
const path = require('path');
const SemanticDataService = require('../utils/SemanticDataService');
const { mergeAllBenches } = require('./joint_sync');

const INTENTS_DIR = __dirname;
const JOINT_BENCH = path.join(INTENTS_DIR, 'joint_bench.json');

async function prune() {
    const threshold = parseFloat(process.argv[2]) || 0.88;

    console.log(`🧹 [Joint Prune] Starting (Threshold: ${threshold})...\n`);

    // --- Pass 1: Intra-Intent Pruning ---
    console.log(`📋 Pass 1: Intra-Intent Pruning...`);
    const entries = fs.readdirSync(INTENTS_DIR, { withFileTypes: true });

    for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const benchPath = path.join(INTENTS_DIR, entry.name, 'bench.json');
        if (!fs.existsSync(benchPath)) continue;

        const service = new SemanticDataService(benchPath);
        const beforeCount = Object.values(service.bench).reduce((sum, item) => sum + (item.variations?.length || 0), 0);

        await service.pruneRepetitions(threshold);

        const afterCount = Object.values(service.bench).reduce((sum, item) => sum + (item.variations?.length || 0), 0);
        const removed = beforeCount - afterCount;

        if (removed > 0) {
            console.log(`  🗑️  ${entry.name}: removed ${removed} duplicates (${beforeCount} → ${afterCount})`);
        }
    }

    // --- Pass 2: Cross-Intent Pruning ---
    console.log(`\n📋 Pass 2: Cross-Intent Overlap Pruning...`);

    // Build a map of variation → [intent1, intent2, ...]
    const variationMap = {};
    const intentBenches = {};

    for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const benchPath = path.join(INTENTS_DIR, entry.name, 'bench.json');
        if (!fs.existsSync(benchPath)) continue;

        try {
            const data = JSON.parse(fs.readFileSync(benchPath, 'utf8'));
            intentBenches[entry.name] = { data, path: benchPath };

            for (const [intentName, intentData] of Object.entries(data)) {
                for (const variation of (intentData.variations || [])) {
                    const key = variation.toLowerCase().trim();
                    if (!variationMap[key]) variationMap[key] = [];
                    variationMap[key].push(intentName);
                }
            }
        } catch (e) {
            // skip
        }
    }

    // Find overlapping variations (same phrase in multiple intents)
    let crossRemoved = 0;
    for (const [variation, intents] of Object.entries(variationMap)) {
        if (intents.length <= 1) continue;

        // Keep the variation in the FIRST intent (alphabetically) and remove from others
        const keeper = intents.sort()[0];
        const toRemove = intents.filter(i => i !== keeper);

        for (const intentName of toRemove) {
            const bench = intentBenches[intentName];
            if (!bench?.data[intentName]?.variations) continue;

            const idx = bench.data[intentName].variations.indexOf(variation);
            if (idx !== -1) {
                bench.data[intentName].variations.splice(idx, 1);
                crossRemoved++;
            }
        }
    }

    // Save updated benches
    for (const [name, bench] of Object.entries(intentBenches)) {
        fs.writeFileSync(bench.path, JSON.stringify(bench.data, null, 2));
    }

    console.log(`  🗑️  Removed ${crossRemoved} cross-intent overlaps.`);

    // --- Merge ---
    console.log(`\n🔗 Rebuilding joint_bench.json...`);
    mergeAllBenches();

    console.log(`\n✨ Joint Prune Complete!`);
}

prune().catch(console.error);
