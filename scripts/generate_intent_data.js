/**
 * Semantic Intent Data Generator
 * Generates massive variations for each intent to train the "Semantic Bench".
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const intentRegistry = require('../src/services/intentResolver/config/intentRegistry');
const { queryAI } = require('../src/core/hfAiService');

const OUTPUT_FILE = path.join(__dirname, '../src/services/intentResolver/config/intent_bench.json');
const VARIATIONS_PER_INTENT = 50; // Total 500+ across all intents

async function generateData() {
    const intents = intentRegistry.getAll();
    const intentNames = Object.keys(intents);
    const bench = {};

    console.log(`🚀 Starting Semantic Data Generation for ${intentNames.length} intents...`);

    for (const name of intentNames) {
        const intent = intents[name];
        console.log(`\n📂 Processing intent: ${name}...`);

        const prompt = `You are a training data generator for an E-commerce AI.
Intent: "${name}"
Description: "${intent.description || 'No description'}"
Keywords: ${intent.keywords.join(', ')}
Synonyms: ${intent.synonyms.join(', ')}

TASK: Generate ${VARIATIONS_PER_INTENT} different ways a user might express this intent in a chat.
GUIDELINES:
1. Include diverse slang (e.g., "cop", "grab", "gimme").
2. Include social noise (e.g., "seriously", "actually", "hey can you...").
3. Include implied needs (e.g., for search: "iPhone 15 screen is cracked").
4. Vary the length (short vs. long).
5. DO NOT include the actual product names in the patterns, use [PRODUCT] or generic terms.

Return a JSON array of strings ONLY. No explanation.`;

        try {
            const response = await queryAI([
                { role: 'system', content: 'You are a high-speed JSON generator.' },
                { role: 'user', content: prompt }
            ], 2000, 0.8, 3, { response_format: { type: "json_object" } });

            let variations = [];
            try {
                const parsed = JSON.parse(response);
                variations = Array.isArray(parsed) ? parsed : (parsed.variations || parsed.examples || Object.values(parsed)[0]);
            } catch (e) {
                // Fallback regex extraction if JSON mode fails
                const match = response.match(/\[.*\]/s);
                if (match) variations = JSON.parse(match[0]);
            }

            if (Array.isArray(variations)) {
                bench[name] = variations.map(v => v.toLowerCase().trim());
                console.log(`   ✅ Generated ${variations.length} variations.`);
            } else {
                console.error(`   ❌ Failed to parse variations for ${name}`);
            }
        } catch (error) {
            console.error(`   ❌ API Error for ${name}:`, error.message);
        }
    }

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(bench, null, 2));
    console.log(`\n✨ DONE! Saved ${Object.values(bench).flat().length} examples to ${OUTPUT_FILE}`);
}

generateData().catch(console.error);
