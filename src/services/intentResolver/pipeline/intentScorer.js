/**
 * Pipeline Stage 7: Intent Scorer — Precision Framework V5.3 (Diagnostic Mode)
 * 
 * Scoring model:
 *   1. Shared-parameter weighting
 *   2. Verb–Noun weighting: keywords (verbs) get 5x, synonyms (nouns) get 1x
 *   3. Data Contract Validation: -12.0 penalty for missing required parameters
 *   4. Multi-Tenant Validation & Boost: 
 *      - PENALTY (-12.0) if 'vendor' is required but not an official store tenant.
 *      - BOOST (+10.0) for ANY vendor-specific intent if an official tenant is detected.
 *   5. Contextual safety guards
 */

const intentRegistry = require('../config/intentRegistry');
const semanticScorer = require('./semanticScorer');

// Weights
const KEYWORD_MULTIPLIER = 5.0;
const SYNONYM_MULTIPLIER = 1.0;
const CONTRACT_PENALTY = -12.0;
const TENANT_BOOST = 10.0; // Significant boost for official store partners

/**
 * Score candidate intents based on extracted parameters and keyword matches.
 * 
 * @param {Array} candidates - Array of { intentName, matchedKeywords, keywordScore }
 * @param {Object} extractedParams - { paramName: value | null }
 * @param {Object} state - User state for contextual bias
 * @param {string} cleanedText - NLP-cleaned text for semantic scoring
 * @param {Object} storeContext - Store context for multi-tenant validation
 * @returns {Object} - { intentName, score, parameters, matchedKeywords }
 */
function scoreIntents(candidates, extractedParams, state = {}, cleanedText = null, storeContext = null) {
    if (candidates.length === 0) return null;

    const vendorsContext = storeContext?.VENDORS;

    let scored = candidates.map(candidate => {
        const intent = intentRegistry.get(candidate.intentName);
        if (!intent) return null;

        const relevantParams = filterParamsForIntent(extractedParams, intent);
        let paramWeightSum = 0;

        // --- 1. SHARED-PARAMETER WEIGHTING ---
        for (const [paramName, value] of Object.entries(relevantParams)) {
            if (value === null || value === undefined) continue;
            const sharedCount = candidates.filter(c => {
                const cIntent = intentRegistry.get(c.intentName);
                return cIntent && cIntent.parameters && cIntent.parameters[paramName];
            }).length;
            paramWeightSum += (1.0 / sharedCount);
        }

        // --- 2. VERB–NOUN WEIGHTING ---
        const keywordSet = new Set((intent.keywords || []).map(k => k.toLowerCase()));
        let verbNounScore = 0;
        for (const matchedKw of (candidate.matchedKeywords || [])) {
            verbNounScore += keywordSet.has(matchedKw.toLowerCase()) ? KEYWORD_MULTIPLIER : SYNONYM_MULTIPLIER;
        }

        let totalScore = paramWeightSum + verbNounScore;

        // --- 3. DATA CONTRACT & TENANT VALIDATION ---
        let isOfficialTenant = false;
        if (intent.parameters) {
            for (const [paramName, paramConfig] of Object.entries(intent.parameters)) {
                let hasValue = extractedParams[paramName] !== null &&
                    extractedParams[paramName] !== undefined &&
                    extractedParams[paramName] !== '';

                // Official Tenant Check
                if (paramName === 'vendor' && hasValue && vendorsContext) {
                    const vLower = extractedParams.vendor.toLowerCase();
                    isOfficialTenant = Object.values(vendorsContext).some(v =>
                        v.business_name.toLowerCase() === vLower ||
                        v.tag.toLowerCase() === vLower ||
                        v.id.toLowerCase() === vLower
                    );

                    if (!isOfficialTenant) {
                        hasValue = false; // Effectively missing for the contract
                    }
                }

                if (paramConfig.required && !hasValue) {
                    totalScore += CONTRACT_PENALTY;
                }
            }
        }

        // Official Tenant Boost
        // If the intent uses a vendor parameter and we actually have an official tenant, boost it!
        if (intent.parameters?.vendor && isOfficialTenant) {
            totalScore += TENANT_BOOST;
        }

        // Diagnostic Log
        console.log(`[IntentScorer] Candidate: ${candidate.intentName}, Base: ${totalScore.toFixed(2)}, Params: ${Object.keys(relevantParams).join(',')}, Keywords: ${candidate.matchedKeywords.join(',')}`);

        // --- 4. CONTEXTUAL SAFETY GUARDS ---
        const { resolveIdToName } = require('./contextResolver');
        const currentlyViewingId = state.product_context?.currently_viewing;
        const currentlyViewingName = currentlyViewingId ? resolveIdToName(currentlyViewingId, state)?.toLowerCase() : null;

        let extractedProduct = null;
        if (extractedParams.products && Array.isArray(extractedParams.products) && extractedParams.products.length > 0) {
            extractedProduct = extractedParams.products[0].toLowerCase();
        } else if (extractedParams.product_name) {
            extractedProduct = extractedParams.product_name.toLowerCase();
        }

        if (candidate.intentName === 'product_search') {
            const junkQueries = ['buy it', 'purchase it', 'order it', 'need', 'want', 'buy', 'grab', 'cop', 'checkout', 'order', 'status'];
            if (extractedProduct && junkQueries.includes(extractedProduct)) totalScore -= 5.0;
        }

        if (candidate.intentName === 'add_to_cart') {
            const navigationalTerms = ['cart', 'basket', 'bag', 'it', 'this', 'that', 'my'];
            if (extractedProduct && navigationalTerms.includes(extractedProduct)) totalScore -= 5.0;
        }

        return {
            intentName: candidate.intentName,
            score: totalScore,
            parameters: relevantParams,
            matchedKeywords: candidate.matchedKeywords,
            invertedFrom: candidate.invertedFrom || null
        };
    }).filter(Boolean);

    if (cleanedText) {
        scored = semanticScorer.scoreSemantically(scored, cleanedText, extractedParams);
    }

    scored.sort((a, b) => {
        if (Math.abs(b.score - a.score) > 0.001) return b.score - a.score;
        return b.matchedKeywords.length - a.matchedKeywords.length;
    });

    return scored[0] || null;
}

function filterParamsForIntent(extractedParams, intent) {
    if (!intent || !intent.parameters) return {};
    const filtered = {};
    for (const paramName of Object.keys(intent.parameters)) {
        if (extractedParams[paramName] !== undefined) filtered[paramName] = extractedParams[paramName];
    }
    return filtered;
}

module.exports = { scoreIntents, filterParamsForIntent };
