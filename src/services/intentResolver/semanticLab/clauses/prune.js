/**
 * CLAUSE PRUNE SCRIPT
 * Hunts down repetitions in the clause bench.
 * Usage: node src/services/intentResolver/semanticLab/clauses/prune.js [threshold]
 */
const path = require('path');
const SemanticDataService = require('../utils/SemanticDataService');

const BENCH_FILE = path.join(__dirname, 'clause_bench.json');

async function prune() {
    const service = new SemanticDataService(BENCH_FILE);
    const threshold = parseFloat(process.argv[2]) || 0.88;

    console.log(`🧹 [Clauses] Starting Fuzzy Pruning (Threshold: ${threshold})...`);
    await service.pruneRepetitions(threshold);
    console.log(`\n✨ Clause Pruning Complete!`);
}

prune().catch(console.error);
