/**
 * Auto-Tag Bench - Uses AI to generate structural templates for untagged variations
 */
const fs = require('fs');
const path = require('path');
// Mocking the AI service interface based on current project patterns
const { queryAI } = require('../../../../utils/aiService');

const BENCH_FILE = path.join(__dirname, '../data/slot_bench.json');
const LOG_FILE = path.join(__dirname, '../logs/auto_tag.log');

const log = (msg) => {
    const timestamp = new Date().toISOString();
    fs.appendFileSync(LOG_FILE, `[${timestamp}] ${msg}\n`);
    console.log(msg);
};

async function generateTemplateWithAI(text, slots) {
    const prompt = [
        {
            role: 'system',
            content: `You are a template generator for a structural extraction system.
Given a user query and a list of available slot tags, replace the entity values in the query with the appropriate tags.
Available tags: ${slots.join(', ')}
Return ONLY the tagged template string.`
        },
        {
            role: 'user',
            content: `Query: "${text}"\nTemplate:`
        }
    ];

    try {
        const response = await queryAI(prompt, 200, 0);
        return response.trim().replace(/^"/, '').replace(/"$/, '');
    } catch (err) {
        log(`AI Error for "${text}": ${err.message}`);
        return null;
    }
}

async function process() {
    log('Starting AI-assisted structural seeding...');

    if (!fs.existsSync(BENCH_FILE)) {
        log(`Error: Slot bench not found at ${BENCH_FILE}`);
        return;
    }

    const data = JSON.parse(fs.readFileSync(BENCH_FILE, 'utf8'));
    // We only process a few intents to avoid massive AI bill, or just the ones with high count
    const targetIntents = ['product_search', 'add_to_cart', 'product_compare'];

    for (const intentName of targetIntents) {
        const entry = data[intentName];
        if (!entry) continue;

        const existingTemplates = new Set(entry.slot_templates || []);
        const variations = entry.variations || [];
        const slots = ['[product]', '[clause]', '[category]', '[vendor]', '[quantity]', '[price]', '[attribute]'];

        log(`Processing intent: ${intentName} (${variations.length} variations)`);

        // Only process variations that don't match existing templates
        // For simplicity in this utility, we'll pick 10 untagged ones to demonstrate
        let sampleCount = 0;
        for (const variation of variations) {
            if (sampleCount >= 10) break;

            // Simplified check: is there a template that matches this variation?
            // (In a real run, we'd use StructuralMatcher)

            const template = await generateTemplateWithAI(variation, slots);
            if (template && !existingTemplates.has(template)) {
                existingTemplates.add(template);
                log(`  [NEW] "${variation}" -> "${template}"`);
                sampleCount++;
            }
        }

        entry.slot_templates = Array.from(existingTemplates);
    }

    fs.writeFileSync(BENCH_FILE, JSON.stringify(data, null, 2));
    log('AI seeding cycle complete.');
}

// Note: This script is intended to be run manually by the developer
// process(); 
