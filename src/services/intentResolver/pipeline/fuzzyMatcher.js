/**
 * Pipeline Stage 1: Fuzzy Matcher
 * Corrects typos in user input using Levenshtein distance.
 * Protects known entity names (products, vendors, categories) from overcorrection.
 * 
 * Imports: intentRegistry (keywords), stopWords, levenshtein util
 * Inline data: NONE
 */

const { findClosest } = require('../utils/levenshtein');
const intentRegistry = require('../config/intentRegistry');
const stopWords = require('../config/stopWords');
const conjunctions = require('../config/conjunctions');

/**
 * Build the correction dictionary from intent keywords and store context entities.
 */
function buildDictionary(storeContext) {
    const dictionary = new Set();

    // Add all intent keywords and synonyms (single words only for word-level matching)
    const allKeywords = intentRegistry.getAllKeywords();
    for (const kw of allKeywords) {
        // Only add single words; multi-word synonyms are handled phrase-level
        if (!kw.includes(' ')) {
            dictionary.add(kw);
        } else {
            // Add individual words from multi-word synonyms too
            kw.split(/\s+/).forEach(w => dictionary.add(w));
        }
    }

    // Add store entity names if available
    if (storeContext) {
        // Category labels
        if (storeContext.CATEGORIES) {
            Object.values(storeContext.CATEGORIES).forEach(cat => {
                if (cat.label) {
                    cat.label.toLowerCase().split(/\s+/).forEach(w => dictionary.add(w));
                }
            });
        }
        // Vendor labels (Business Name & Tag)
        if (storeContext.VENDORS) {
            Object.values(storeContext.VENDORS).forEach(v => {
                if (v.business_name) v.business_name.toLowerCase().split(/\s+/).forEach(w => dictionary.add(w));
                if (v.tag) v.tag.toLowerCase().split(/\s+/).forEach(w => dictionary.add(w));
            });
        }
    }

    return Array.from(dictionary);
}

/**
 * Build a set of known entity words to protect from overcorrection.
 */
function buildEntitySet(storeContext) {
    const entities = new Set();

    if (!storeContext) return entities;

    if (storeContext.CATEGORIES) {
        Object.values(storeContext.CATEGORIES).forEach(cat => {
            if (cat.label) entities.add(cat.label.toLowerCase());
        });
    }

    if (storeContext.VENDORS) {
        Object.values(storeContext.VENDORS).forEach(v => {
            if (v.business_name) entities.add(v.business_name.toLowerCase());
            if (v.tag) entities.add(v.tag.toLowerCase());
        });
    }

    // Add Clause labels from Attributes
    if (storeContext.ATTRIBUTES) {
        Object.values(storeContext.ATTRIBUTES).forEach(attr => {
            if (attr.clauses) {
                attr.clauses.forEach(clause => {
                    if (clause.label) entities.add(clause.label.toLowerCase());
                });
            }
        });
    }

    return entities;
}

/**
 * Correct typos in user text.
 * - Skips digits, stop words, and very short words (≤2 chars)
 * - Protects entity names and conjunctions from overcorrection
 * - Only corrects if Levenshtein distance ≤ 2
 * - Requires length similarity (prevents "iphone" → "phones")
 * - Short words (≤4 chars) only corrected if distance = 1
 */
const commonWords = require('../config/commonWords');

/**
 * Correct typos in user text.
 * - Skips common English words (Common Word Guard)
 * - Skips if it's already part of an entity
 * - Only corrects to primary keywords (Primary Keyword Guard)
 */
function correctText(text, storeContext) {
    const dictionary = buildDictionary(storeContext);
    const entitySet = buildEntitySet(storeContext);
    const stopSet = new Set(stopWords);
    const conjunctionSet = new Set(conjunctions.map(c => c.toLowerCase()));
    const words = text.split(/\s+/);
    const corrected = [];

    // Primary Keyword Guard: we only want to correct typos into CORE intent verbs
    // to prevent social noise from being mangled.
    const primaryKeywords = [];
    const allIntents = intentRegistry.getAll();
    for (const intent of Object.values(allIntents)) {
        primaryKeywords.push(...(intent.keywords || []));
    }

    for (const word of words) {
        const lower = word.toLowerCase();

        // 1. Common Word Guard: If it's a common English word, don't touch it.
        // This protects "love", "seriously", "actually", etc.
        if (commonWords.has(lower)) {
            corrected.push(word);
            continue;
        }

        // 2. Skip digits, very short words, and stop words
        if (/^\d+$/.test(word) || lower.length <= 2 || stopSet.has(lower)) {
            corrected.push(word);
            continue;
        }

        // 3. Protect conjunctions
        if (conjunctionSet.has(lower)) {
            corrected.push(word);
            continue;
        }

        // 4. Skip if it's already a known word in the dictionary
        if (dictionary.includes(lower)) {
            corrected.push(word);
            continue;
        }

        // 5. Entity Guard
        let isEntity = false;
        for (const entity of entitySet) {
            if (entity.includes(lower) || lower.includes(entity)) {
                isEntity = true;
                break;
            }
        }
        if (isEntity) {
            corrected.push(word);
            continue;
        }

        // 6. Correction Logic
        const maxDist = lower.length <= 4 ? 1 : 2;
        const closest = findClosest(lower, primaryKeywords, maxDist); // Only correct to PRIMARY keywords

        if (closest && closest.distance > 0) {
            const distRatio = closest.distance / lower.length;

            // Compound Noun Guard: If the original word contains the match (e.g. "iphone" vs "phone")
            // or vice-versa, and the length difference isn't massive, it's likely a specific term, not a typo.
            const isSubset = lower.includes(closest.match) || closest.match.includes(lower);
            if (isSubset && Math.abs(lower.length - closest.match.length) <= 2) {
                corrected.push(word);
                continue;
            }

            if (distRatio <= 0.30) {
                corrected.push(closest.match);
            } else {
                corrected.push(word);
            }
        } else {
            corrected.push(word);
        }
    }

    return corrected.join(' ');
}

module.exports = { correctText, buildDictionary, buildEntitySet };
