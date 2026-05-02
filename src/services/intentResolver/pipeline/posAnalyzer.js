/**
 * POS Analyzer — Pipeline Part-of-Speech Tagging
 *
 * Wraps compromise (same engine as pos_repl.js) as a reusable pipeline module.
 * Produces a word-keyed Map so downstream stages can look up any word's POS
 * without index-alignment concerns (word indices shift when cleanText() strips words
 * or contextResolver injects collapsed tokens).
 *
 * Design:
 *   - Tagged ONCE per statement in the preprocessor, attached as statement.posTagMap
 *   - All downstream stages (prepass, entity extractor) receive the same Map
 *   - Gate is NEGATIVE: only block words that are demonstrably wrong POS
 *   - Whitelist overrides all gates — store-known terms always pass
 */

const nlp = require('compromise');

// ── POS tags that are VALID for entity matching ──────────────────────────────
// A word with ANY of these tags is allowed through the gate.
const VALID_TAGS = new Set([
    // Noun-like
    'Noun', 'ProperNoun', 'FirstName', 'LastName',
    'Place', 'Organization', 'Person', 'Demonym', 'Acronym',
    // Adjective-like (descriptors: "affordable", "red", "large")
    'Adjective', 'Comparative', 'Superlative',
    // Numeric (attribute values: "256GB", "32", "50000")
    'Cardinal',
]);

// ── POS tags that DISQUALIFY a word (when no valid tag is also present) ──────
// "looking" → Gerund + Verb → both disqualifying, no valid tag → BLOCKED
// "running shoes" → "running" has Gerund + Adjective → Adjective is valid → ALLOWED
const DISQUALIFYING_TAGS = new Set([
    'Verb', 'Gerund', 'Infinitive', 'PastTense', 'PresentTense', 'Auxiliary',
    'Adverb',
    'Pronoun',
    'Conjunction',
    'Determiner',
    'Preposition',
    'QuestionWord',
    'Negative',
]);

/**
 * Build a tagSet from compromise's raw tags field.
 * Handles both v14+ object format ({ Noun: true }) and older array format.
 */
function buildTagSet(rawTags) {
    if (!rawTags) return new Set();
    if (Array.isArray(rawTags)) return new Set(rawTags);
    if (typeof rawTags === 'object') return new Set(Object.keys(rawTags));
    return new Set();
}

/**
 * Tag all words in a text string using compromise.
 * Returns a Map<string, Set<string>> — lowercased word → set of POS tag strings.
 *
 * Called once per statement in the preprocessor. Downstream stages call:
 *   const tagSet = posTagMap.get(word.toLowerCase());
 *
 * @param {string} text - Normalized, lowercased statement text
 * @returns {Map<string, Set<string>>}
 */
function tagWords(text) {
    if (!text || typeof text !== 'string') return new Map();

    const doc = nlp(text);
    const sentences = doc.json(); // [{ text, terms: [{text, tags:{...}}, ...] }]
    const posTagMap = new Map();

    for (const sentence of sentences) {
        if (!Array.isArray(sentence.terms)) continue;
        for (const term of sentence.terms) {
            const word = (term.text || '').toLowerCase().trim();
            if (!word) continue;
            const tagSet = buildTagSet(term.tags);
            // If the same word appears twice, merge tag sets (cover both roles)
            if (posTagMap.has(word)) {
                const existing = posTagMap.get(word);
                for (const t of tagSet) existing.add(t);
            } else {
                posTagMap.set(word, tagSet);
            }
        }
    }

    return posTagMap;
}

/**
 * Check if a word should be blocked by the POS gate.
 *
 * Returns true (disqualified) ONLY when:
 *   1. Word is NOT in the whitelist
 *   2. posTagMap has tags for this word
 *   3. None of those tags are VALID
 *   4. At least one tag is DISQUALIFYING
 *
 * Returns false (allowed) when:
 *   - Word is in whitelist
 *   - Word has no tag data (ambiguity = allow)
 *   - Word has at least one VALID tag (even alongside disqualifying ones)
 *
 * @param {string} word - Lowercased word to check
 * @param {Map<string, Set<string>>} posTagMap - From tagWords()
 * @param {Set<string>} whitelist - Store-known terms that bypass the gate
 * @returns {boolean} true = block this word
 */
function isDisqualified(word, posTagMap, whitelist) {
    const w = (word || '').toLowerCase();

    // 1. Whitelist override — store terms always pass
    if (whitelist && whitelist.has(w)) return false;

    // 2. No POS data → allow (don't block on ambiguity)
    const tagSet = posTagMap ? posTagMap.get(w) : null;
    if (!tagSet || tagSet.size === 0) return false;

    // 3. Any valid tag → allow
    for (const tag of tagSet) {
        if (VALID_TAGS.has(tag)) return false;
    }

    // 4. Has disqualifying tag(s) and no valid tag → block
    for (const tag of tagSet) {
        if (DISQUALIFYING_TAGS.has(tag)) return true;
    }

    // 5. Unknown tags only → allow (don't block on unknown)
    return false;
}

/**
 * Check if a multi-word phrase should be blocked by the POS gate.
 * Phrase passes if AT LEAST ONE word is not disqualified.
 * This handles patterns like "brand new" (brand=Noun, new=Adjective → passes)
 * and "256GB storage" (256GB=Cardinal → passes).
 *
 * @param {string[]} phraseWords - Lowercased array of words in the phrase
 * @param {Map<string, Set<string>>} posTagMap
 * @param {Set<string>} whitelist
 * @returns {boolean} true = phrase passes (at least one valid word)
 */
function phrasePassesPosGate(phraseWords, posTagMap, whitelist) {
    if (!posTagMap) return true; // gate disabled → always pass
    return phraseWords.some(w => !isDisqualified(w, posTagMap, whitelist));
}

// ── Clause/Brand whitelist (module-level cached) ──────────────────────────────
// Keys from CLAUSE_LOOKUP and BRAND_LOOKUP — all valid clause/brand words
// the prepass is allowed to match, regardless of what compromise thinks of them.
let _clauseWhitelist = null;

/**
 * Build (and cache) a whitelist of all words known to the clause/brand system.
 * Used by the prepass — it doesn't have access to storeContext.
 * @returns {Set<string>}
 */
function buildClauseWhitelist() {
    if (_clauseWhitelist) return _clauseWhitelist;

    const { CLAUSES } = require('../../../context/clauses');
    _clauseWhitelist = new Set();

    for (const clause of Object.values(CLAUSES)) {
        if (!clause) continue;
        const add = (str) => {
            const w = (str || '').toLowerCase().trim();
            if (w.length > 1) {
                // Add each token of multi-word entries too
                w.split(/\s+/).filter(Boolean).forEach(t => _clauseWhitelist.add(t));
                _clauseWhitelist.add(w);
            }
        };
        add(clause.label);
        (clause.matches || []).forEach(add);
        add(clause.display?.prefix);
        add(clause.display?.suffix);
    }

    return _clauseWhitelist;
}

/**
 * Build a full store whitelist for entity extractor use.
 * Includes all CATEGORY label/slug tokens + VENDOR name tokens + clause whitelist.
 * Called once per extractEntities() call and reused across all N-gram iterations.
 *
 * @param {Object} storeContext - { CATEGORIES, VENDORS }
 * @returns {Set<string>}
 */
function buildStoreWhitelist(storeContext) {
    const whitelist = new Set(buildClauseWhitelist()); // start with clause terms

    const tokenize = (str) => (str || '').toLowerCase().split(/[\s\-_\/]+/).filter(t => t.length > 1);

    if (storeContext && storeContext.CATEGORIES) {
        for (const cat of Object.values(storeContext.CATEGORIES)) {
            if (!cat) continue;
            tokenize(cat.label).forEach(t => whitelist.add(t));
            tokenize(cat.slug).forEach(t => whitelist.add(t));
        }
    }

    if (storeContext && storeContext.VENDORS) {
        for (const vendor of Object.values(storeContext.VENDORS)) {
            if (!vendor) continue;
            tokenize(vendor.business_name).forEach(t => whitelist.add(t));
            if (vendor.tag) whitelist.add(vendor.tag.toLowerCase().trim());
        }
    }

    return whitelist;
}

module.exports = {
    tagWords,
    isDisqualified,
    phrasePassesPosGate,
    buildClauseWhitelist,
    buildStoreWhitelist,
};
