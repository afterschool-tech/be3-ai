/**
 * Prune Templates - Cleans the slot bench of redundant or low-value templates
 */
const fs = require('fs');
const path = require('path');

const BENCH_FILE = path.join(__dirname, '../data/slot_bench.json');
const LOG_FILE = path.join(__dirname, '../logs/pruning.log');

const log = (msg) => {
    const timestamp = new Date().toISOString();
    fs.appendFileSync(LOG_FILE, `[${timestamp}] ${msg}\n`);
    console.log(msg);
};

function prune() {
    log('Starting structural template pruning...');

    if (!fs.existsSync(BENCH_FILE)) {
        log(`Error: Slot bench not found at ${BENCH_FILE}`);
        return;
    }

    const data = JSON.parse(fs.readFileSync(BENCH_FILE, 'utf8'));
    let totalRemoved = 0;

    for (const [intentName, entry] of Object.entries(data)) {
        if (!entry.slot_templates || entry.slot_templates.length === 0) continue;

        const originalCount = entry.slot_templates.length;

        // 1. Uniqueness
        let templates = Array.from(new Set(entry.slot_templates));

        // 2. Filter out bad templates
        templates = templates.filter(t => {
            // Must contain at least one slot
            if (!t.includes('[') || !t.includes(']')) return false;

            // Must contain at least some literal text (not JUST slots)
            // Exception: some short phrases might be just slots, but generally unsafe
            const literalText = t.replace(/\[[a-z_]+\]/g, '').trim();
            if (literalText.length < 3 && t.split(' ').length < 3) return false;

            // Filter out very long templates (probably bad data)
            if (t.length > 150) return false;

            return true;
        });

        // 3. Sort by specificity (length/complexity) for better matching later
        // Actually, the index build script handles regex ordering, but sorting here helps readability
        templates.sort((a, b) => b.length - a.length);

        entry.slot_templates = templates;
        const removed = originalCount - templates.length;
        totalRemoved += removed;

        if (removed > 0) {
            log(`Intent ${intentName}: Pruned ${removed} templates (Remaining: ${templates.length})`);
        }
    }

    fs.writeFileSync(BENCH_FILE, JSON.stringify(data, null, 2));
    log(`Pruning complete. Total removed: ${totalRemoved}`);
}

prune();
