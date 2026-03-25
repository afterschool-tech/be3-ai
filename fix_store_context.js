/**
 * Fix storeContext: reset to 'none' for all intents that don't need upfront context.
 * Only check_availability, browse_categories, discovery_sentinel truly need it.
 */
const fs = require('fs');
const path = require('path');

const configDir = path.join(__dirname, 'src/services/intentResolver/config/intents');

// Intents that ACTUALLY need store context injected upfront
const NEEDS_STORE_CONTEXT = new Set(['check_availability', 'browse_categories', 'discovery_sentinel']);

const files = fs.readdirSync(configDir).filter(f => f.endsWith('.js'));
let fixed = 0;

for (const file of files) {
    const intentName = file.replace('.js', '');
    if (NEEDS_STORE_CONTEXT.has(intentName)) {
        console.log(`KEEP lean: ${file}`);
        continue;
    }

    const filePath = path.join(configDir, file);
    let content = fs.readFileSync(filePath, 'utf8');

    // Replace storeContext: 'lean' or 'full' with 'none'
    const updated = content.replace(/storeContext:\s*'(lean|full)'/g, "storeContext: 'none'");

    if (updated !== content) {
        fs.writeFileSync(filePath, updated, 'utf8');
        console.log(`FIXED: ${file}`);
        fixed++;
    } else {
        console.log(`SKIP: ${file} (already none)`);
    }
}

console.log(`\nDone. Fixed: ${fixed}`);
