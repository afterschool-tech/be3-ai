/**
 * Build Index - Compiles slot templates into Regex patterns
 */
const fs = require('fs');
const path = require('path');

const BENCH_FILE = path.join(__dirname, '../data/slot_bench.json');
const OUTPUT_FILE = path.join(__dirname, '../data/compiled_index.json');
const LOG_FILE = path.join(__dirname, '../logs/build.log');

const log = (msg) => {
    const timestamp = new Date().toISOString();
    fs.appendFileSync(LOG_FILE, `[${timestamp}] ${msg}\n`);
    console.log(msg);
};

// Map tags to Regex groups
const TAG_MAP = {
    '[product]': '(?<product_name>.+)',
    '[clause]': '(?<clause_words>.+)',
    '[category]': '(?<category>.+)',
    '[vendor]': '(?<vendor>.+)',
    '[price]': '(?<price_max>.+)',
    '[quantity]': '(?<quantity>.+)',
    '[order_id]': '(?<order_id>.+)',
    '[attribute]': '(?<attributes>.+)'
};

function templateToRegex(template) {
    let pattern = template.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Group counters to avoid duplicate named groups
    const counters = {};

    // First, find all tags in order from left to right ([product], [clause], etc.)
    const tagMatches = [...template.matchAll(/\[[a-z_]+\]/g)];

    // Process each tag match
    tagMatches.forEach((match, index) => {
        const tag = match[0];
        const isLast = (index === tagMatches.length - 1);
        const groupInfo = TAG_MAP[tag];
        if (!groupInfo) return;

        // Extract base name from group pattern
        const baseNameMatch = groupInfo.match(/\?<([a-z_]+)>/);
        if (!baseNameMatch) return;

        const baseName = baseNameMatch[1];
        counters[baseName] = (counters[baseName] || 0) + 1;
        const groupName = counters[baseName] > 1 ? `${baseName}_${counters[baseName]}` : baseName;

        const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        // Smarter Quantifier: 
        // If it's the last tag AND at the end of the template string, make it greedy (.+)
        // to catch multi-word values like "iphone 12 pro".
        // Otherwise use lazy matching (.+?) to stop at the next anchor.
        const templateRemainder = template.substring(match.index + tag.length);
        const isAtEnd = templateRemainder.trim().length === 0;
        const quantifier = (isLast && isAtEnd) ? '.+' : '.+?';

        const replacement = groupInfo.replace(baseName, groupName).replace('.+', quantifier);

        pattern = pattern.replace(escapedTag, replacement);
    });

    return `(?:^|\\b)${pattern}(?:\\b|$)`;
}

function build() {
    log('Starting index building...');

    if (!fs.existsSync(BENCH_FILE)) {
        log(`Error: Slot bench not found at ${BENCH_FILE}`);
        return;
    }

    const data = JSON.parse(fs.readFileSync(BENCH_FILE, 'utf8'));
    const index = {};
    let totalTemplates = 0;

    for (const [intentName, entry] of Object.entries(data)) {
        if (!entry.slot_templates || entry.slot_templates.length === 0) continue;

        index[intentName] = entry.slot_templates.map(template => ({
            template,
            regex: templateToRegex(template)
        }));

        totalTemplates += entry.slot_templates.length;
        log(`Compiled ${entry.slot_templates.length} templates for ${intentName}`);
    }

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(index, null, 2));
    log(`Build complete. Saved ${totalTemplates} patterns across ${Object.keys(index).length} intents to ${OUTPUT_FILE}`);
}

build();
