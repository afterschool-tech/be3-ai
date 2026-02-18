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
