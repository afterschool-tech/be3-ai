/**
 * Script: Add class/intent hierarchy metadata to all intent config files.
 * Run once: node scripts/add_hierarchy_metadata.js
 * 
 * Reads taxonomy.js, then patches each intent config file by inserting
 * `class` and `intent` fields right after the `name` field.
 */

const fs = require('fs');
const path = require('path');
const { SUBINTENT_TO_HIERARCHY } = require('../src/services/intentResolver/config/taxonomy');

const intentsDir = path.join(__dirname, '..', 'src', 'services', 'intentResolver', 'config', 'intents');

const files = fs.readdirSync(intentsDir).filter(f => f.endsWith('.js'));

let modified = 0;
let skipped = 0;
let noMapping = 0;

for (const file of files) {
    const filePath = path.join(intentsDir, file);
    let content = fs.readFileSync(filePath, 'utf8');
    
    // Extract the intent name from the file
    const nameMatch = content.match(/name:\s*'([^']+)'/);
    if (!nameMatch) {
        console.log(`⚠️  SKIP ${file} — no name field found`);
        skipped++;
        continue;
    }
    
    const intentName = nameMatch[1];
    const hierarchy = SUBINTENT_TO_HIERARCHY[intentName];
    
    if (!hierarchy) {
        console.log(`📋 SKIP ${file} (${intentName}) — no taxonomy mapping (short-circuit or test)`);
        noMapping++;
        continue;
    }
    
    // Check if already has class field
    if (content.includes("class: '")) {
        console.log(`✅ SKIP ${file} — already has class field`);
        skipped++;
        continue;
    }
    
    // Insert class and intent fields right after the name line
    const nameLineRegex = /(name:\s*'[^']+')/;
    const replacement = `$1,\n    class: '${hierarchy.class}',\n    intent: '${hierarchy.intent}'`;
    
    const newContent = content.replace(nameLineRegex, replacement);
    
    if (newContent === content) {
        console.log(`❌ FAIL ${file} — regex didn't match`);
        continue;
    }
    
    fs.writeFileSync(filePath, newContent, 'utf8');
    console.log(`✅ DONE ${file} — ${intentName} → ${hierarchy.class} / ${hierarchy.intent}`);
    modified++;
}

console.log(`\n--- Summary ---`);
console.log(`Modified: ${modified}`);
console.log(`Skipped:  ${skipped}`);
console.log(`No mapping: ${noMapping}`);
console.log(`Total files: ${files.length}`);
