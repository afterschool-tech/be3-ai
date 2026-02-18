/**
 * Semantic Data Cleanup Script
 * Hunts down repetitions and fuzzy-duplicates in the bench.
 * Usage: node scripts/cleanup_semantic_data.js [threshold]
 */
const path = require('path');
require('dotenv').config();

const SemanticDataService = require('../src/services/intentResolver/services/semanticDataService');
const OUTPUT_FILE = path.join(__dirname, '../src/services/intentResolver/config/intent_bench.json');

async function cleanup() {
    const threshold = parseFloat(process.argv[2]) || 0.9;
    const service = new SemanticDataService(OUTPUT_FILE);

    console.log(`🚀 Starting Semantic Data Cleanup (Threshold: ${threshold})...`);

    const beforeCountTotal = Object.values(service.bench).reduce((sum, item) => sum + (item.variations?.length || 0), 0);
    const intentStats = {};
    for (const [key, item] of Object.entries(service.bench)) {
        intentStats[key] = { before: item.variations?.length || 0 };
    }

    await service.pruneRepetitions(threshold);

    let afterCountTotal = 0;
    for (const [key, item] of Object.entries(service.bench)) {
        intentStats[key].after = item.variations?.length || 0;
        afterCountTotal += intentStats[key].after;
    }

    console.log(`\n📊 --- CLEANUP SUMMARY ---`);
    for (const [key, stat] of Object.entries(intentStats)) {
        const removed = stat.before - stat.after;
        console.log(`   ${key.padEnd(20)}: ${stat.before} -> ${stat.after} (${removed > 0 ? '❌ -' + removed : '✨ clean'})`);
    }

    console.log(`\n✨ Done!`);
    console.log(`📊 Total Variations: ${beforeCountTotal} -> ${afterCountTotal} (Removed: ${beforeCountTotal - afterCountTotal})`);

    if (beforeCountTotal === afterCountTotal) {
        console.log(`✅ [Stability] Bench is already optimal at ${threshold}. No further cleanup needed.`);
    }
}

cleanup().catch(console.error);
