/**
 * Hybrid Intent Resolver — Pipeline Orchestrator
 * 
 * Wires together all 8 pipeline stages in sequence:
 *   1. fuzzyMatcher   — typo correction
 *   2. contextResolver — pronoun/ref resolution from state
 *   3. preprocessor    — normalize + negate + split
 *   4. candidateDetector — keyword matching
 *   5. parameterExtractor — deterministic + AI
 *   6. parameterBleeder — cross-intent param inheritance
 *   7. intentScorer   — dynamic shared-parameter weighting
 *   8. toolMapper     — intent → tool call
 * 
 * Signature: resolveAndMap(userMessage, state, aiQueryFn, storeContext)
 * 
 * Imports: all pipeline stages
 * Inline data: NONE
 */

const fuzzyMatcher = require('./pipeline/fuzzyMatcher');
const contextResolver = require('./pipeline/contextResolver');
const preprocessor = require('./pipeline/preprocessor');
const candidateDetector = require('./pipeline/candidateDetector');
const parameterExtractor = require('./pipeline/parameterExtractor');
const parameterBleeder = require('./pipeline/parameterBleeder');
const parameterNormalizer = require('./pipeline/parameterNormalizer');
const intentScorer = require('./pipeline/intentScorer');
const toolMapper = require('./pipeline/toolMapper');
const { cleanText, stripSocialNoise } = require('./pipeline/nlpCleaner');

/**
 * Main entry point: resolve user message into tool calls.
 */
async function resolveAndMap(userMessage, state, aiQueryFn, storeContext) {
    // Stage 1: Fuzzy correction (with Guards)
    const afterFuzzy = fuzzyMatcher.correctText(userMessage, storeContext);

    // Stage 2: Context resolution (pronouns, ordinals, brand refs)
    const { resolvedText: afterContext, resolutions } = contextResolver.resolveReferences(afterFuzzy, state);

    // Stage 3: Preprocess (normalize, negate, split)
    const { statements, isMultiIntent } = preprocessor.preprocess(afterContext);

    const resolvedStatements = [];

    for (const statement of statements) {
        // --- NLP CLEANING FOR DETECTION ---
        // Strip adverbs and fluff so "seriously need" -> "need"
        const cleanedText = cleanText(statement.text);

        // Stage 4: Candidate detection (Deterministic)
        // Pass the full statement object but with cleaned text for detection
        const candidates = candidateDetector.detectCandidates({
            ...statement,
            text: cleanedText
        });

        if (candidates.length === 0) {
            // Rule 8 (Implicit): If no deterministic match, the AI fallback in paramExtractor might help
            // but we need at least a potential candidate. 
            // We'll proceed with a "generic" candidate if the message looks like a request.
            continue;
        }

        // Stage 5: Parameter extraction (AI + Deterministic)
        // Note: AI uses the ORIGINAL statement text for full context
        const extractedParams = await parameterExtractor.extractParameters(
            statement.text, candidates, aiQueryFn
        );

        // Stage 7: Score and pick winner
        const winner = intentScorer.scoreIntents(candidates, extractedParams, state);

        if (winner) {
            resolvedStatements.push({
                intentName: winner.intentName,
                score: winner.score,
                parameters: winner.parameters,
                extractedParams,
                matchedKeywords: winner.matchedKeywords,
                invertedFrom: winner.invertedFrom
            });
        }
    }

    // --- RULE 8: CLARIFICATION FALLBACK ---
    if (resolvedStatements.length === 0 && userMessage.length > 3) {
        return {
            intents: [{ intentName: 'fallback_unknown', score: 0, parameters: {} }],
            tools: [{ tool: 'conversation.clarify', params: { query: userMessage }, reason: 'Rule 8: Unknown Intent' }],
            isMultiIntent: false,
            corrections: { original: userMessage, afterFuzzy, afterContext }
        };
    }

    // Stage 6: Cross-intent parameter bleeding
    const bledStatements = parameterBleeder.bleedParameters(resolvedStatements);

    // Stage 6.5: Parameter Normalization
    const normalizedStatements = parameterNormalizer.normalizeParameters(bledStatements, storeContext);

    // Build final intents array
    const intents = normalizedStatements.map(stmt => ({
        intentName: stmt.intentName,
        score: stmt.score,
        parameters: stmt.parameters,
        matchedKeywords: stmt.matchedKeywords,
        invertedFrom: stmt.invertedFrom,
        bledParams: stmt.bledParams || []
    }));

    // Stage 8: Map intents to tool calls
    const tools = toolMapper.mapToTools(intents.map(i => ({
        intentName: i.intentName,
        parameters: i.parameters || {}
    })));

    return {
        intents,
        tools,
        isMultiIntent,
        corrections: {
            original: userMessage,
            afterFuzzy,
            afterContext
        },
        resolutions
    };
}

module.exports = { resolveAndMap };
