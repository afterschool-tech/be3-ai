/**
 * Pipeline Stage 7: Intent Scorer — Precision Framework V5
 * 
 * Scoring model:
 *   1. Shared-parameter weighting (existing)
 *   2. Verb–Noun weighting: keywords (verbs) get 5x, synonyms (nouns) get 1x
 *   3. Data Contract Validation: -25.0 penalty for missing required parameters
 *   4. Contextual safety guards (junk queries, navigational terms)
 *   5. Semantic scoring boost
 */

const intentRegistry = require('../config/intentRegistry');
const semanticScorer = require('./semanticScorer');

// Weights
const KEYWORD_MULTIPLIER = 5.0;   // Action verbs (keywords) are heavily weighted
const SYNONYM_MULTIPLIER = 1.0;   // Nouns/phrases (synonyms) are baseline
const CONTRACT_PENALTY = -12.0;   // Softened from -25.0 to allow recovery via semantic boost

/**
 * Score candidate intents based on extracted parameters and keyword matches.
 * Returns the winning intent with its score and parameters.
 * 
 * @param {Array} candidates - Array of { intentName, matchedKeywords, keywordScore }
 * @param {Object} extractedParams - { paramName: value | null }
 * @param {Object} state - User state for contextual bias
 * @param {string} cleanedText - NLP-cleaned text for semantic scoring
 * @returns {Object} - { intentName, score, parameters, matchedKeywords }
 */
function scoreIntents(candidates, extractedParams, state = {}, cleanedText = null) {
    if (candidates.length === 0) {
        return null;
    }

    let scored = candidates.map(candidate => {
        const intent = intentRegistry.get(candidate.intentName);
        if (!intent) return null;

        const relevantParams = filterParamsForIntent(extractedParams, intent);
        let paramWeightSum = 0;

        // --- SHARED-PARAMETER WEIGHTING ---
        for (const [paramName, value] of Object.entries(relevantParams)) {
            if (value === null || value === undefined) continue;

            const sharedCount = candidates.filter(c => {
                const cIntent = intentRegistry.get(c.intentName);
                return cIntent && cIntent.parameters && cIntent.parameters[paramName];
            }).length;

            const weight = 1.0 / sharedCount;
            paramWeightSum += weight;
        }

        // --- VERB–NOUN WEIGHTING ---
        // Keywords (action verbs like "add", "remove", "search") get 5x multiplier
        // Synonyms (noun phrases like "shopping bag", "my basket") get 1x
        const keywordSet = new Set((intent.keywords || []).map(k => k.toLowerCase()));
        let verbNounScore = 0;

        for (const matchedKw of (candidate.matchedKeywords || [])) {
            const kw = matchedKw.toLowerCase();
            if (keywordSet.has(kw)) {
                verbNounScore += KEYWORD_MULTIPLIER;
            } else {
                verbNounScore += SYNONYM_MULTIPLIER;
            }
        }

        let totalScore = paramWeightSum + verbNounScore;

        // --- DATA CONTRACT VALIDATION ---
        // Automatically penalize intents that are missing required parameters
        if (intent.parameters) {
            for (const [paramName, paramConfig] of Object.entries(intent.parameters)) {
                if (paramConfig.required) {
                    const hasValue = extractedParams[paramName] !== null &&
                        extractedParams[paramName] !== undefined &&
                        extractedParams[paramName] !== '';
                    if (!hasValue) {
                        totalScore += CONTRACT_PENALTY;
                        console.log(`[IntentScorer] Contract Penalty: ${candidate.intentName} missing required "${paramName}" → ${CONTRACT_PENALTY}`);
                    }
                }
            }
        }

        // --- CONTEXTUAL SAFETY GUARDS ---
        const { resolveIdToName } = require('./contextResolver');
        const currentlyViewingId = state.product_context?.currently_viewing;
        const currentlyViewingName = currentlyViewingId ? resolveIdToName(currentlyViewingId, state)?.toLowerCase() : null;

        let extractedProduct = null;
        if (extractedParams.products && Array.isArray(extractedParams.products) && extractedParams.products.length > 0) {
            extractedProduct = extractedParams.products[0].toLowerCase();
        } else if (extractedParams.product_name) {
            extractedProduct = extractedParams.product_name.toLowerCase();
        }

        // Junk Query Guard: penalize search when query is a navigational term
        if (candidate.intentName === 'product_search') {
            const junkQueries = [
                'buy it', 'purchase it', 'order it',
                'i want to buy', 'i want to get', 'i want to order',
                'let me get', 'let me buy', 'need', 'want', 'buy', 'grab', 'cop',
                'checkout', 'order', 'status'
            ];
            if (extractedProduct && junkQueries.includes(extractedProduct)) {
                totalScore -= 5.0;
            }
        }

        // Junk Product Guard: penalize cart actions when product is a navigational term
        if (candidate.intentName === 'add_to_cart') {
            const navigationalTerms = ['cart', 'basket', 'bag', 'it', 'this', 'that', 'my'];
            if (extractedProduct && navigationalTerms.includes(extractedProduct)) {
                totalScore -= 5.0;
            }

            // Weak Desire Penalty (e.g. "i want to buy" without context → search)
            try {
                const weakSynonyms = require('../config/weakSynonyms');
                const weakSet = new Set(weakSynonyms.map(s => s.toLowerCase()));
                const isWeakDesire = candidate.matchedKeywords.some(kw => weakSet.has(kw.toLowerCase()));

                if (isWeakDesire && (!currentlyViewingName || extractedProduct !== currentlyViewingName)) {
                    totalScore -= 2.0;
                }
            } catch (e) {
                // weakSynonyms config may not exist
            }
        }

        return {
            intentName: candidate.intentName,
            score: totalScore,
            parameters: relevantParams,
            matchedKeywords: candidate.matchedKeywords,
            invertedFrom: candidate.invertedFrom || null
        };
    }).filter(Boolean);

    // --- SEMANTIC SCORING ---
    if (cleanedText) {
        scored = semanticScorer.scoreSemantically(scored, cleanedText, extractedParams);
    }

    // Sort by score descending, tie-break by keyword match count
    scored.sort((a, b) => {
        if (Math.abs(b.score - a.score) > 0.001) return b.score - a.score;
        return b.matchedKeywords.length - a.matchedKeywords.length;
    });

    return scored[0] || null;
}

/**
 * Filter extracted params to only include those relevant to the given intent.
 */
function filterParamsForIntent(extractedParams, intent) {
    if (!intent || !intent.parameters) return {};

    const filtered = {};
    for (const paramName of Object.keys(intent.parameters)) {
        if (extractedParams[paramName] !== undefined) {
            filtered[paramName] = extractedParams[paramName];
        }
    }
    return filtered;
}

module.exports = { scoreIntents, filterParamsForIntent };
