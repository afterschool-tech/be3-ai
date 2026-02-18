/**
 * Pipeline Stage 7: Intent Scorer
 * Dynamic shared-parameter weighting and scoring.
 * 
 * For each candidate intent:
 *   For each non-null parameter that belongs to this intent:
 *     weight = 1.0 / (number of candidate intents that also use this param)
 *   intent_score = sum(param_weights) + (keywordScore * 0.5)
 * 
 * Imports: intentRegistry from config
 * Inline data: NONE
 */

const intentRegistry = require('../config/intentRegistry');

/**
 * Score candidate intents based on extracted parameters and keyword matches.
 * Returns the winning intent with its score and parameters.
 * 
 * @param {Array} candidates - Array of { intentName, matchedKeywords, keywordScore }
 * @param {Object} extractedParams - { paramName: value | null }
 * @param {Object} state - User state for contextual bias
 * @returns {Object} - { intentName, score, parameters, matchedKeywords }
 */
function scoreIntents(candidates, extractedParams, state = {}) {
    if (candidates.length === 0) {
        return null;
    }

    // Multiple candidates: calculate shared-parameter weighting
    const scored = candidates.map(candidate => {
        const intent = intentRegistry.get(candidate.intentName);
        if (!intent) return null;

        const relevantParams = filterParamsForIntent(extractedParams, intent);
        let paramWeightSum = 0;

        for (const [paramName, value] of Object.entries(relevantParams)) {
            if (value === null || value === undefined) continue;

            // Count how many candidate intents use this parameter
            const sharedCount = candidates.filter(c => {
                const cIntent = intentRegistry.get(c.intentName);
                return cIntent && cIntent.parameters && cIntent.parameters[paramName];
            }).length;

            const weight = 1.0 / sharedCount;
            paramWeightSum += weight;
        }

        let totalScore = paramWeightSum + (candidate.keywordScore * 0.5);

        // --- CONTEXTUAL BIAS (Phase 20) ---
        // Address "buy sugar" (search) vs "buy it" (cart)
        const { resolveIdToName } = require('./contextResolver');
        const currentlyViewingId = state.product_context?.currently_viewing;
        const currentlyViewingName = currentlyViewingId ? resolveIdToName(currentlyViewingId, state)?.toLowerCase() : null;

        // Extract product name for comparison. 
        // Can come from 'products' (list) or 'product_name' (string)
        let extractedProduct = null;
        if (extractedParams.products && Array.isArray(extractedParams.products) && extractedParams.products.length > 0) {
            extractedProduct = extractedParams.products[0].toLowerCase();
        } else if (extractedParams.product_name) {
            extractedProduct = extractedParams.product_name.toLowerCase();
        }

        if (candidate.intentName === 'product_search') {
            // Bias towards search if:
            // 1. No product is mentioned (browsing)
            // 2. OR if we're NOT currently viewing anything (new intent)
            // 3. OR if it's a DIFFERENT product than what we're viewing
            if (!extractedProduct || !currentlyViewingName || extractedProduct !== currentlyViewingName) {
                totalScore += 2.5; // Much stronger bias for search (replicated "buy" success)
            }

            // --- JUNK QUERY PENALTY ---
            // If the query is just a stopword or another intent's keyword (like "cart"), aggressively penalize search
            const junkQueries = [
                'my', 'me', 'the', 'some', 'any', 'a', 'an', 'it', 'this', 'that',
                'cart', 'basket', 'bag', 'checkout', 'order', 'status'
            ];
            if (extractedProduct && junkQueries.includes(extractedProduct)) {
                totalScore -= 5.0; // Knock it out
            }
        } else if (candidate.intentName === 'view_cart' || candidate.intentName === 'start_checkout' || candidate.intentName === 'check_order_status') {
            // Navigational Boost: These are usually direct commands with keywords
            if (candidate.matchedKeywords.length > 0) {
                totalScore += 2.0; // Stronger boost
            }
        } else if (candidate.intentName === 'add_to_cart') {
            // Bias towards cart ONLY if product MATCHES or if it was a resolved pronoun
            if (extractedProduct && currentlyViewingName && extractedProduct === currentlyViewingName) {
                totalScore += 1.0;
            }

            // --- WEAK DESIRE PENALTY ---
            // If triggered by "i want", "i need", etc. WITHOUT context, penalize for cart
            const weakSynonyms = require('../config/weakSynonyms');
            const weakSet = new Set(weakSynonyms.map(s => s.toLowerCase()));
            const isWeakDesire = candidate.matchedKeywords.some(kw => weakSet.has(kw.toLowerCase()));

            if (isWeakDesire && (!currentlyViewingName || extractedProduct !== currentlyViewingName)) {
                totalScore -= 2.0; // Replicate "i want to buy" success by pushing towards search
            }

            // --- JUNK PRODUCT PENALTY ---
            // If we're adding "cart" to cart, it's almost certainly a misinterpretation of "view cart"
            const navigationalTerms = ['cart', 'basket', 'bag', 'it', 'this', 'that', 'my'];
            if (extractedProduct && navigationalTerms.includes(extractedProduct)) {
                totalScore -= 5.0; // Knock it out
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

    // Sort by score descending, tie-break by keyword score
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
