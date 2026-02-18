const path = require('path');
const SemanticMatcher = require('../semanticLab/utils/SemanticMatcher');

const BENCH_FILE = path.join(__dirname, '../semanticLab/intents/intent_bench.json');
const matcher = new SemanticMatcher(BENCH_FILE, 'Intents');
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

module.exports = { scoreSemantically };
