const path = require('path');
const fs = require('fs');
const SemanticMatcher = require('../semanticLab/utils/SemanticMatcher');

// Load semantic variations from individual intent benches (Decentralized)
const INTENTS_DIR = path.join(__dirname, '../semanticLab/intents');
const matcher = new SemanticMatcher(INTENTS_DIR, 'Intents');
const semanticCache = new Map();
const MAX_CACHE_SIZE = 500;

/**
 * Stage 7.5: Semantic Scorer
 */
function scoreSemantically(intentWinners, cleanedText, extractedParams = {}) {
    if (!matcher.isLoaded || !intentWinners.length) return intentWinners;

    // --- CACHE CHECK ---
    const cacheKey = `${cleanedText}_${intentWinners.map(w => w.intentName).join(',')}`;
    if (semanticCache.has(cacheKey)) {
        return semanticCache.get(cacheKey);
    }

    // --- PRODUCT TOKENIZATION ---
    let maskedText = cleanedText;
    const productsToMask = [];
    if (extractedParams.products && Array.isArray(extractedParams.products)) {
        productsToMask.push(...extractedParams.products);
    } else if (extractedParams.product_name) {
        productsToMask.push(extractedParams.product_name);
    }

    productsToMask.sort((a, b) => b.length - a.length);

    for (const p of productsToMask) {
        if (!p || p.length < 2) continue;
        const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(escaped, 'gi');
        maskedText = maskedText.replace(regex, '[product]');
    }

    // --- SHARED MATCHER LOOKUP ---
    const matches = matcher.findMatches(maskedText);

    const result = intentWinners.map(winner => {
        const match = matches.find(m => m.id === winner.intentName);
        if (!match) return winner;

        // Cap the total semantic boost at 6.0 to let deterministic logic still work.
        const boost = Math.min(6.0, match.boost);

        return {
            ...winner,
            score: winner.score + boost,
            semanticSimilarity: match.similarity,
            vectorScore: match.vectorScore,
            semanticBoost: boost
        };
    });

    // --- UPDATE CACHE ---
    if (semanticCache.size >= MAX_CACHE_SIZE) {
        const firstKey = semanticCache.keys().next().value;
        semanticCache.delete(firstKey);
    }
    semanticCache.set(cacheKey, result);

    return result;
}

/**
 * Exported tool for Stage 4: Candidate Detection
 * Allows the detector to find potential intents even if keywords don't match.
 * @param {string} text - The cleaned user input.
 * @returns {Array} - List of { intentName, score }
 */
function discoverCandidates(text) {
    if (!matcher.isLoaded) return [];

    // Basic masking for discovery (no extracted params yet, just guess based on CAPS or common nouns)
    const matches = matcher.findMatches(text);

    // Return any match that has a significant signal
    return matches
        .filter(m => m.similarity > 0.4 || m.vectorScore > 0.05)
        .map(m => ({
            intentName: m.id,
            score: m.boost / 2.0 // Lower weight for discovery phase
        }));
}

module.exports = {
    scoreSemantically,
    discoverCandidates
};
