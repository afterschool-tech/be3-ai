/**
 * Sync from benches - pulls data from root benches into structural system
 */
const fs = require('fs');
const path = require('path');

const INTENTS_BENCH = path.join(__dirname, '../../intents/joint_bench.json');
const CLAUSES_BENCH = path.join(__dirname, '../../clauses/clause_bench.json');
const OUTPUT_FILE = path.join(__dirname, '../data/slot_bench.json');
const LOG_FILE = path.join(__dirname, '../logs/sync.log');

const log = (msg) => {
    const timestamp = new Date().toISOString();
    fs.appendFileSync(LOG_FILE, `[${timestamp}] ${msg}\n`);
    console.log(msg);
};

function sync() {
    log('Starting sync from benches...');

    if (!fs.existsSync(INTENTS_BENCH)) {
        log(`Error: Intent bench not found at ${INTENTS_BENCH}`);
        return;
    }

    const intentData = JSON.parse(fs.readFileSync(INTENTS_BENCH, 'utf8'));
    const clauseData = fs.existsSync(CLAUSES_BENCH) ? JSON.parse(fs.readFileSync(CLAUSES_BENCH, 'utf8')) : {};

    const slotBench = {};

    // Sync intents
    for (const [intentName, entry] of Object.entries(intentData)) {
        slotBench[intentName] = {
            variations: entry.variations || [],
            slot_templates: [], // Initial empty, to be filled by manually or by tag_slots.js
            metadata: entry.metadata || {}
        };
        log(`Synced intent: ${intentName} (${(entry.variations || []).length} variations)`);
    }

    // Sync clauses (treated as special intents for tagging purposes)
    for (const [clauseId, entry] of Object.entries(clauseData)) {
        const key = `clause_${clauseId}`;
        slotBench[key] = {
            variations: entry.variations || [],
            slot_templates: [],
            metadata: { type: 'clause', originalId: clauseId }
        };
        log(`Synced clause: ${clauseId} (${(entry.variations || []).length} variations)`);
    }

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(slotBench, null, 2));
    log(`Sync complete. Saved ${Object.keys(slotBench).length} entries to ${OUTPUT_FILE}`);
}

sync();
