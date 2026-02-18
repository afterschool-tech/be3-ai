/**
 * INTENT BENCH MIGRATION SCRIPT
 * Splits the monolithic intent_bench.json into per-intent folders.
 * Each intent gets its own folder with a bench.json file.
 * 
 * Usage: node src/services/intentResolver/semanticLab/intents/migrate.js
 * 
 * This is a ONE-TIME script. After running, the old intent_bench.json is kept as backup.
 */
const fs = require('fs');
const path = require('path');

const BENCH_FILE = path.join(__dirname, 'intent_bench.json');
const INTENTS_DIR = __dirname;

async function migrate() {
    console.log('🔄 [Migration] Starting intent bench migration...');

    if (!fs.existsSync(BENCH_FILE)) {
        console.error('❌ intent_bench.json not found!');
        process.exit(1);
    }

    const bench = JSON.parse(fs.readFileSync(BENCH_FILE, 'utf8'));
    const intentNames = Object.keys(bench);

    console.log(`📊 Found ${intentNames.length} intents in monolith bench.`);

    for (const intentName of intentNames) {
        const intentData = bench[intentName];
        const intentDir = path.join(INTENTS_DIR, intentName);

        // Create intent folder
        if (!fs.existsSync(intentDir)) {
            fs.mkdirSync(intentDir, { recursive: true });
        }

        // Write intent-specific bench.json
        const intentBench = {
            [intentName]: intentData
        };

        const benchPath = path.join(intentDir, 'bench.json');
        fs.writeFileSync(benchPath, JSON.stringify(intentBench, null, 2));

        const varCount = intentData.variations?.length || 0;
        const runs = intentData.metadata?.runs || 0;
        console.log(`  ✅ ${intentName}/ → bench.json (${varCount} variations, ${runs} runs)`);
    }

    // Create a backup of the original
    const backupPath = path.join(INTENTS_DIR, 'intent_bench.backup.json');
    fs.copyFileSync(BENCH_FILE, backupPath);
    console.log(`\n💾 Backup saved to intent_bench.backup.json`);

    console.log(`\n✨ Migration complete! ${intentNames.length} intent folders created.`);
    console.log(`   Run joint_sync.js to generate the joint_bench.json.`);
}

migrate().catch(console.error);
