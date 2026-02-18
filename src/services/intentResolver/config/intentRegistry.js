/**
 * Intent Registry
 * Auto-loads all intent definition files from the intents/ directory.
 * To add a new intent: just drop a new .js file in config/intents/.
 */

const fs = require('fs');
const path = require('path');

const intentsDir = path.join(__dirname, 'intents');
const intents = {};

fs.readdirSync(intentsDir)
    .filter(file => file.endsWith('.js'))
    .forEach(file => {
        const intent = require(path.join(intentsDir, file));
        intents[intent.name] = intent;
    });

/**
 * Get all registered intents.
 */
function getAll() {
    return intents;
}

/**
 * Get a single intent by name.
 */
function get(name) {
    return intents[name] || null;
}

/**
 * Get all intent names.
 */
function getNames() {
    return Object.keys(intents);
}

/**
 * Build a flat keyword-to-intent map for fast lookup.
 * Returns { keyword: [intentName1, intentName2, ...] }
 */
function buildKeywordMap() {
    const map = {};

    for (const [name, intent] of Object.entries(intents)) {
        for (const kw of intent.keywords) {
            const key = kw.toLowerCase();
            if (!map[key]) map[key] = [];
            if (!map[key].includes(name)) map[key].push(name);
        }
        for (const syn of intent.synonyms) {
            const key = syn.toLowerCase();
            if (!map[key]) map[key] = [];
            if (!map[key].includes(name)) map[key].push(name);
        }
    }

    return map;
}

/**
 * Collect all keywords and synonyms from all intents as a flat array.
 * Used by fuzzyMatcher to build its correction dictionary.
 */
function getAllKeywords() {
    const keywords = new Set();

    for (const intent of Object.values(intents)) {
        intent.keywords.forEach(kw => keywords.add(kw.toLowerCase()));
        intent.synonyms.forEach(syn => keywords.add(syn.toLowerCase()));
    }

    return Array.from(keywords);
}

module.exports = { getAll, get, getNames, buildKeywordMap, getAllKeywords };
