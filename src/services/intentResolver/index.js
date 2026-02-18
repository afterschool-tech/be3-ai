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
const intentPorter = require('./pipeline/intentPorter');
const toolMapper = require('./pipeline/toolMapper');
const { cleanText, stripSocialNoise } = require('./pipeline/nlpCleaner');
const { logDebug } = require('../../utils/debugLogger');

/**
 * Main entry point: resolve user message into tool calls.
 */
async function resolveAndMap(userMessage, state, aiQueryFn, storeContext) {
    // Stage 1: Fuzzy correction (with Guards)
    const afterFuzzy = fuzzyMatcher.correctText(userMessage, storeContext);
    logDebug('PIPELINE:STAGE1_FUZZY', {
        original: userMessage,
        corrected: afterFuzzy,
        changed: userMessage !== afterFuzzy
    });

    // Stage 2: Context resolution (pronouns, ordinals, brand refs)
    const { resolvedText: afterContext, resolutions } = contextResolver.resolveReferences(afterFuzzy, state);
    logDebug('PIPELINE:STAGE2_CONTEXT', {
        input: afterFuzzy,
        resolved: afterContext,
        resolutions: resolutions,
        changed: afterFuzzy !== afterContext
    });

    // Stage 3: Preprocess (normalize, negate, split)
    const { statements, isMultiIntent } = preprocessor.preprocess(afterContext);
    logDebug('PIPELINE:STAGE3_PREPROCESS', {
        input: afterContext,
        statementCount: statements.length,
        isMultiIntent,
        statements: statements.map(s => ({ text: s.text, negated: s.negated }))
    });

    const resolvedStatements = [];

    for (let i = 0; i < statements.length; i++) {
        const statement = statements[i];
        const cleanedText = cleanText(statement.text);

        logDebug(`PIPELINE:STAGE4_CANDIDATES [Statement ${i + 1}/${statements.length}]`, {
            originalText: statement.text,
            cleanedText,
            negated: statement.negated
        });

        // Stage 4: Candidate detection (Deterministic)
        const candidates = candidateDetector.detectCandidates({
            ...statement,
            text: cleanedText
        });

        logDebug(`PIPELINE:STAGE4_CANDIDATES_RESULT [Statement ${i + 1}]`, {
            candidateCount: candidates.length,
            candidates: candidates.map(c => ({
                intent: c.intentName,
                score: c.score,
                matchedKeywords: c.matchedKeywords
            }))
        });

        if (candidates.length === 0) {
            logDebug(`PIPELINE:STAGE4_NO_MATCH [Statement ${i + 1}]`, {
                text: cleanedText,
                action: 'Skipping — no candidates detected'
            });
            continue;
        }

        // Stage 5: Parameter extraction (AI + Deterministic)
        const extractedParams = await parameterExtractor.extractParameters(
            statement.text, candidates, aiQueryFn, storeContext, resolutions
        );
        logDebug(`PIPELINE:STAGE5_PARAMS [Statement ${i + 1}]`, {
            text: statement.text,
            aiUsed: !!aiQueryFn,
            extractedParams
        });

        // Stage 7: Score and pick winner (with Semantic Boosting)
        const winner = intentScorer.scoreIntents(candidates, extractedParams, state, cleanedText);
        logDebug(`PIPELINE:STAGE7_SCORING [Statement ${i + 1}]`, {
            winner: winner ? {
                intent: winner.intentName,
                score: winner.score,
                parameters: winner.parameters,
                matchedKeywords: winner.matchedKeywords
            } : null
        });

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
        logDebug('PIPELINE:RULE8_FALLBACK', {
            reason: 'No statements resolved to a valid intent',
            userMessage,
            action: 'Returning fallback_unknown + conversation.clarify'
        });
        return {
            intents: [{ intentName: 'fallback_unknown', score: 0, parameters: {} }],
            tools: [{ tool: 'conversation.clarify', params: { query: userMessage }, reason: 'Rule 8: Unknown Intent' }],
            isMultiIntent: false,
            corrections: { original: userMessage, afterFuzzy, afterContext }
        };
    }

    // Stage 7.5: Intent Porting (Dynamic Buy-vs-Search)
    const portedStatements = intentPorter.portIntents(resolvedStatements, state);
    logDebug('PIPELINE:STAGE7.5_PORTING', {
        before: resolvedStatements.map(s => s.intentName),
        after: portedStatements.map(s => s.intentName)
    });

    // Stage 6: Cross-intent parameter bleeding
    const bledStatements = parameterBleeder.bleedParameters(portedStatements);
    logDebug('PIPELINE:STAGE6_BLEEDING', {
        before: portedStatements.map(s => ({ intent: s.intentName, params: s.parameters })),
        after: bledStatements.map(s => ({ intent: s.intentName, params: s.parameters, bledParams: s.bledParams }))
    });

    // Stage 6.5: Parameter Normalization
    const normalizedStatements = parameterNormalizer.normalizeParameters(bledStatements, storeContext);
    logDebug('PIPELINE:STAGE6.5_NORMALIZATION', {
        normalized: normalizedStatements.map(s => ({ intent: s.intentName, params: s.parameters }))
    });

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

    logDebug('PIPELINE:STAGE8_TOOL_MAPPING', {
        intents: intents.map(i => ({ intent: i.intentName, score: i.score, params: i.parameters })),
        tools: tools.map(t => ({ tool: t.tool, params: t.params, reason: t.reason }))
    });

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
