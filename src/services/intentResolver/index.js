/**
 * Hybrid Intent Resolver — Pipeline Orchestrator
 * 
 * Wires together all pipeline stages in sequence:
 *   1. fuzzyMatcher     — typo correction
 *   2. contextResolver  — pronoun/ref resolution from state
 *   3. preprocessor     — normalize + negate + split
 *   4a. entityExtractor — typed entity extraction (vendors, categories, brands, actions)
 *   4b. schemaResolver  — schema-fit intent matching + IDF confirmation
 *   5. parameterExtractor — fill remaining params (deterministic + AI)
 *   6. parameterBleeder — cross-intent param inheritance
 *   7. intentPorter     — dynamic buy-vs-search pivoting
 *   8. parameterNormalizer — vendor/category ID normalization
 *   9. toolMapper       — intent → tool call
 * 
 * Signature: resolveAndMap(userMessage, state, aiQueryFn, storeContext)
 * 
 * Imports: all pipeline stages
 * Inline data: NONE
 */

const fuzzyMatcher = require('./pipeline/fuzzyMatcher');
const contextResolver = require('./pipeline/contextResolver');
const preprocessor = require('./pipeline/preprocessor');
const { extractEntities } = require('./pipeline/entityExtractor');
const { resolveIntent } = require('./pipeline/schemaResolver');
const parameterExtractor = require('./pipeline/parameterExtractor');
const parameterBleeder = require('./pipeline/parameterBleeder');
const parameterNormalizer = require('./pipeline/parameterNormalizer');
const intentPorter = require('./pipeline/intentPorter');
const toolMapper = require('./pipeline/toolMapper');
const { cleanText, stripSocialNoise } = require('./pipeline/nlpCleaner');
const { logDebug } = require('../../utils/debugLogger');
const intentRegistry = require('./config/intentRegistry');

// Build IDF map once at module load
const idfMap = intentRegistry.buildIdfMap();

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

    // Intra-query coreference: track entities from previous statements
    // for pronoun resolution within the same multi-statement query
    let prevStatementEntities = []; // entities from the last processed statement
    let prevStatementResiduals = []; // residual words (likely product names) from last statement

    // Pronouns that can refer to entities from previous statement
    const SINGULAR_PRONOUNS = new Set(['it', 'this', 'that', 'the one', 'the product']);
    const PLURAL_PRONOUNS = new Set(['them', 'they', 'those', 'these', 'the products', 'all of them', 'both']);

    for (let i = 0; i < statements.length; i++) {
        const statement = statements[i];
        let textForExtraction = statement.text;

        // ── Stage 3b: Intra-Query Coreference Resolution ──
        // Only for multi-statement queries (i > 0): replace pronouns using
        // entities from the PREVIOUS statement in the same query.
        // Single statements are always resolved from state (Stage 2 already did that).
        if (isMultiIntent && i > 0 && prevStatementEntities.length > 0) {
            const lowerText = textForExtraction.toLowerCase();

            // Collect product-like names from previous statement entities
            const prevProductNames = [];
            const prevVendorNames = [];
            for (const e of prevStatementEntities) {
                if (e.type === 'vendor') prevVendorNames.push(e.value);
                else if (e.type === 'category') prevProductNames.push(e.value);
                else if (e.type === 'brand') prevProductNames.push(e.value);
            }
            // Residual words from prev statement are also likely product names
            if (prevStatementResiduals && prevStatementResiduals.length > 0) {
                prevProductNames.push(prevStatementResiduals.join(' '));
            }

            const allPrevNames = [...prevProductNames];
            const singularRef = allPrevNames.length > 0 ? allPrevNames[allPrevNames.length - 1] : null;
            const pluralRef = allPrevNames.length > 0 ? allPrevNames.join(' and ') : null;

            // Replace pronouns only if they weren't already resolved by Stage 2
            // (Stage 2 resolves from state reference_map; we check if the pronoun
            // is still present in the text — if so, state didn't resolve it)
            if (singularRef) {
                for (const pronoun of SINGULAR_PRONOUNS) {
                    const regex = new RegExp(`\\b${pronoun}\\b`, 'gi');
                    if (regex.test(lowerText)) {
                        textForExtraction = textForExtraction.replace(regex, singularRef);
                    }
                }
            }
            if (pluralRef) {
                for (const pronoun of PLURAL_PRONOUNS) {
                    const regex = new RegExp(`\\b${pronoun}\\b`, 'gi');
                    if (regex.test(lowerText)) {
                        textForExtraction = textForExtraction.replace(regex, pluralRef);
                    }
                }
            }

            if (textForExtraction !== statement.text) {
                logDebug(`PIPELINE:STAGE3B_COREF [Statement ${i + 1}]`, {
                    original: statement.text,
                    resolved: textForExtraction,
                    prevEntities: prevStatementEntities.map(e => e.type + ':' + (e.value || e.verb))
                });
            }
        }

        const cleanedText = cleanText(textForExtraction);

        // Stage 4a: Entity Extraction
        const extractionResult = extractEntities(cleanedText, storeContext, idfMap);

        logDebug(`PIPELINE:STAGE4A_ENTITIES [Statement ${i + 1}/${statements.length}]`, {
            text: cleanedText,
            entities: extractionResult.entities.map(e => ({ type: e.type, value: e.value || e.verb, idf: e.idf })),
            residualWords: extractionResult.residualWords
        });

        // Stage 4b: Schema Resolution (replaces candidateDetector + intentScorer)
        const resolution = resolveIntent(extractionResult, cleanedText, idfMap, storeContext);
        logDebug(`PIPELINE:STAGE4B_SCHEMA [Statement ${i + 1}]`, {
            winner: resolution.winner ? {
                intent: resolution.winner.intentName,
                score: resolution.winner.score,
                matchedKeywords: resolution.winner.matchedKeywords,
                matchedParams: resolution.winner.matchedParams
            } : null,
            topCandidates: resolution.candidates.slice(0, 3).map(c => ({
                intent: c.intentName,
                score: c.score.toFixed(2)
            })),
            fallbackUsed: resolution.fallbackUsed
        });

        // Always update coreference trackers — previous statement entities
        // are valid antecedents even if no intent winner was found
        prevStatementEntities = extractionResult.entities;
        prevStatementResiduals = extractionResult.residualWords;

        if (!resolution.winner) {
            logDebug(`PIPELINE:STAGE4B_NO_MATCH [Statement ${i + 1}]`, {
                text: cleanedText,
                action: 'Skipping — no intent resolved'
            });
            continue;
        }

        // Build lightweight candidates array for parameterExtractor compatibility
        const candidates = resolution.candidates.map(c => ({
            intentName: c.intentName,
            matchedKeywords: c.matchedKeywords,
            keywordScore: c.score
        }));

        // Stage 5: Parameter extraction (AI + Deterministic)
        // Uses the resolved candidates to fill remaining params
        const extractedParams = await parameterExtractor.extractParameters(
            statement.text, candidates, aiQueryFn, storeContext, resolutions
        );
        logDebug(`PIPELINE:STAGE5_PARAMS [Statement ${i + 1}]`, {
            text: statement.text,
            aiUsed: !!aiQueryFn,
            extractedParams
        });

        // Merge schema-matched params with extractor params
        // Schema params take precedence for entities we already identified
        const mergedParams = { ...extractedParams, ...resolution.winner.matchedParams };

        // Handle negation: invert intent if applicable
        let resolvedIntentName = resolution.winner.intentName;
        let invertedFrom = null;
        if (statement.negated) {
            const intent = intentRegistry.get(resolvedIntentName);
            if (intent && intent.invertTo) {
                invertedFrom = resolvedIntentName;
                resolvedIntentName = intent.invertTo;
            }
        }

        resolvedStatements.push({
            intentName: resolvedIntentName,
            score: resolution.winner.score,
            parameters: mergedParams,
            extractedParams,
            matchedKeywords: resolution.winner.matchedKeywords,
            invertedFrom
        });
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
