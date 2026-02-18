/**
 * INTENT PRUNE SCRIPT
 * Hunts down repetitions in the intent bench.
 * Usage: node src/services/intentResolver/semanticLab/intents/prune.js [threshold]
 */
const path = require('path');
const SemanticDataService = require('../utils/SemanticDataService');

const BENCH_FILE = path.join(__dirname, 'intent_bench.json');

async function prune() {
    const service = new SemanticDataService(BENCH_FILE);
    const threshold = parseFloat(process.argv[2]) || 0.88;

    console.log(`🧹 [Intents] Starting Fuzzy Pruning (Threshold: ${threshold})...`);
    await service.pruneRepetitions(threshold);
    console.log(`\n✨ Intent Pruning Complete!`);
}

prune().catch(console.error);
