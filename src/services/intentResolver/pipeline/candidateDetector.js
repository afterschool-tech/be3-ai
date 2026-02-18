/**
 * Pipeline Stage 4: Candidate Detector
 * Deterministic intent candidate detection using keywords and synonyms.
 * 
 * Imports: intentRegistry from config
 * Inline data: NONE
 */

const intentRegistry = require('../config/intentRegistry');
const intentInversions = require('../config/intentInversions');
const weakSynonyms = require('../config/weakSynonyms');

// Pre-build weak synonym set for fast lookup
const weakSet = new Set(weakSynonyms.map(s => s.toLowerCase()));

/**
 * Detect candidate intents for a single sub-statement.
 * Performs multi-word phrase matching first, then single-word matching.
 * Returns candidates sorted by keywordScore (highest first).
 */
function detectCandidates(statement) {
    const { text, negated } = statement;
    const allIntents = intentRegistry.getAll();
    const candidates = [];

    for (const [intentName, intent] of Object.entries(allIntents)) {
        const matchedKeywords = [];
        let keywordScore = 0;

        // Phase 1: Multi-word phrase matching (synonyms)
        for (const synonym of intent.synonyms) {
            if (synonym.includes(' ')) {
                // Multi-word synonym: check if the full phrase appears in the text
                if (text.includes(synonym.toLowerCase())) {
                    matchedKeywords.push(synonym);
                    // Weak synonyms (generic phrases) score much less
                    if (weakSet.has(synonym.toLowerCase())) {
                        keywordScore += 0.3;
                    } else {
                        // Strong multi-word phrases score by word count
                        keywordScore += synonym.split(/\s+/).length;
                    }
                }
            }
        }

        // Phase 2: Single-word keyword matching
        for (const keyword of intent.keywords) {
            const kwLower = keyword.toLowerCase();
            // Match as whole word
            const regex = new RegExp(`\\b${escapeRegex(kwLower)}\\b`, 'i');
            if (regex.test(text) && !matchedKeywords.includes(kwLower)) {
                matchedKeywords.push(kwLower);
                keywordScore += 1;
            }
        }

        // Phase 3: Single-word synonym matching
        for (const synonym of intent.synonyms) {
            if (!synonym.includes(' ')) {
                const synLower = synonym.toLowerCase();
                const regex = new RegExp(`\\b${escapeRegex(synLower)}\\b`, 'i');
                if (regex.test(text) && !matchedKeywords.includes(synLower)) {
                    matchedKeywords.push(synLower);
                    keywordScore += 0.5; // Synonyms score less than primary keywords
                }
            }
        }

        if (matchedKeywords.length > 0) {
            let resolvedIntentName = intentName;
            let invertedFrom = null;

            // Handle negation: invert intent if applicable
            if (negated && intentInversions[intentName]) {
                resolvedIntentName = intentInversions[intentName];
                invertedFrom = intentName;
            }

            candidates.push({
                intentName: resolvedIntentName,
                matchedKeywords,
                keywordScore,
                invertedFrom
            });
        }
    }

    // Phase 4.5: Semantic Candidate Discovery (The "Language Intuition" Layer)
    // If we have few or no high-quality keyword candidates (score < 3), ask the semantic bench
    // to suggest intents based on language similarity.
    const bestScore = candidates.length > 0 ? candidates[0].keywordScore : 0;
    if (bestScore < 3.0) {
        try {
            const semanticScorer = require('./semanticScorer');
            if (semanticScorer && semanticScorer.discoverCandidates) {
                const semanticCandidates = semanticScorer.discoverCandidates(text);
                for (const sc of semanticCandidates) {
                    // Only add if not already a candidate (or if keywordScore is very low)
                    const existing = candidates.find(c => c.intentName === sc.intentName);
                    if (!existing) {
                        candidates.push({
                            intentName: sc.intentName,
                            matchedKeywords: ['semantic'],
                            keywordScore: sc.score, // Use raw semantic score as initial bias
                            invertedFrom: null
                        });
                    }
                }
            }
        } catch (e) {
            // Silently fail if semanticScorer is unavailable or bench isn't loaded
        }
    }

    // Phase 4: Orphan Product Fallback
    // If no candidates found, and text contains non-stop-words, default to product_search
    if (candidates.length === 0 && text.trim().length > 0) {
        const stopWords = require('../config/stopWords');
        const words = text.toLowerCase().split(/\s+/).filter(w => !stopWords.includes(w) && w.length > 0);

        if (words.length > 0) {
            candidates.push({
                intentName: 'product_search',
                matchedKeywords: ['implicit'],
                keywordScore: 0.5,
                invertedFrom: null
            });
        }
    }

    // Sort by keywordScore descending
    candidates.sort((a, b) => b.keywordScore - a.keywordScore);

    return candidates;
}

/**
 * Escape special regex characters.
 */
function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = { detectCandidates };
