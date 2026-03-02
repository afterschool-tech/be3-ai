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
const { shouldSkipAmbiguousReference } = contextResolver;
const preprocessor = require('./pipeline/preprocessor');
const { extractEntities } = require('./pipeline/entityExtractor');
const { resolveIntent } = require('./pipeline/schemaResolver');
const parameterExtractor = require('./pipeline/parameterExtractor');
const parameterBleeder = require('./pipeline/parameterBleeder');
const parameterNormalizer = require('./pipeline/parameterNormalizer');
const intentPorter = require('./pipeline/intentPorter');
const toolMapper = require('./pipeline/toolMapper');
const microstateRunner = require('./pipeline/microstateRunner');
const stack = require('./pipeline/stack');
const contextReconciler = require('./pipeline/contextReconciler');
const { cleanText, stripSocialNoise } = require('./pipeline/nlpCleaner');
const { createPositionTracker } = require('./pipeline/extractionPositionTracker');
const { runResidualChunkAnalysis } = require('./pipeline/residualChunkAnalyzer');
const { logDebug } = require('../../utils/debugLogger');
const { getParent, getSiblings, getPath, isRoot, findById } = require('../../context/categoryHelpers');
const intentRegistry = require('./config/intentRegistry');
const microstateRegistry = require('./config/microstateRegistry');
const stateManager = require('../../state/stateManager');
const { resolveEngineeredToken, resolveGroupedOrdinal, resolveOrdinal } = require('../../utils/responseResolver');
const { callBackendAPI } = require('../../utils/apiClient');
const { processProductList } = require('../../utils/productUtility');

// Build IDF map once at module load
const idfMap = intentRegistry.buildIdfMap();

/**
 * Main entry point: resolve user message into tool calls.
 */
async function resolveAndMap(userMessage, state, aiQueryFn, storeContext) {
    const userId = state.user_id;

    // Stage 0a: Engineered pagination tokens (no microstate required)
    // If user clicks a "See more" button, WA sends __nav:more__.
    // We re-run the last product.search with page increment.
    const rawEarly = String(userMessage || '').trim();
    const engineeredEarly = resolveEngineeredToken(rawEarly);
    if (engineeredEarly && engineeredEarly.namespace === 'nav' && (engineeredEarly.command === 'more' || engineeredEarly.command === 'prev') && userId) {
        const last = state.product_context?.last_search;
        let baseFilters = last?.filters && typeof last.filters === 'object' ? last.filters : null;

        // Snapshot-aware pagination: __nav:more:<snapshotId>__
        const snapshotId = engineeredEarly.arg ? String(engineeredEarly.arg).trim() : null;
        if (snapshotId) {
            try {
                const snap = await stateManager.getSearchSnapshot(userId, snapshotId);
                if (snap?.filters && typeof snap.filters === 'object') {
                    baseFilters = snap.filters;
                }
            } catch (_) { }
        }

        if (baseFilters) {
            const currentPage = Number.isFinite(baseFilters.page) ? Number(baseFilters.page) : 1;
            const delta = engineeredEarly.command === 'prev' ? -1 : 1;
            const nextPage = Math.max(1, currentPage + delta);
            return {
                intents: [],
                tools: [{
                    tool: 'product.search',
                    params: {
                        ...baseFilters,
                        page: nextPage
                    },
                    reason: 'Engineered pagination'
                }],
                isMultiIntent: false,
                corrections: { original: userMessage },
                resolutions: [],
                engineered_pagination: true
            };
        }
    }

    // Stage 0b: Engineered clause filter buttons (no microstate required)
    // Clause buttons emitted by product.search use: __filter:clause:<attrCode>:<clauseName>__
    // We re-run the last product.search with an attribute clause applied and reset to page 1.
    if (engineeredEarly && engineeredEarly.namespace === 'filter' && engineeredEarly.command === 'clause' && userId) {
        const last = state.product_context?.last_search;
        let baseFilters = last?.filters && typeof last.filters === 'object' ? last.filters : null;
        const arg = engineeredEarly.arg ? String(engineeredEarly.arg) : '';
        const parts = arg.split(':').filter(Boolean);
        let snapshotId = null;
        let attrCode = parts[0] || null;
        let clauseName = parts.slice(1).join(':') || null;

        // Snapshot-aware clause token: __filter:clause:<snapshotId>:<attrCode>:<clauseName>__
        if (parts.length >= 3) {
            snapshotId = parts[0] || null;
            attrCode = parts[1] || null;
            clauseName = parts.slice(2).join(':') || null;
        }
        if (clauseName) {
            try {
                clauseName = decodeURIComponent(clauseName);
            } catch (_) { }
        }

        if (snapshotId) {
            try {
                const snap = await stateManager.getSearchSnapshot(userId, snapshotId);
                if (snap?.filters && typeof snap.filters === 'object') {
                    baseFilters = snap.filters;
                }
            } catch (_) { }
        }

        if (baseFilters && attrCode && clauseName) {
            const baseAttrs = (baseFilters.attributes && typeof baseFilters.attributes === 'object')
                ? baseFilters.attributes
                : {};

            return {
                intents: [],
                tools: [{
                    tool: 'product.search',
                    params: {
                        ...baseFilters,
                        page: 1,
                        attributes: {
                            ...baseAttrs,
                            [`${attrCode}:${clauseName}`]: clauseName
                        }
                    },
                    reason: 'Engineered clause filter'
                }],
                isMultiIntent: false,
                corrections: { original: userMessage },
                resolutions: [],
                engineered_clause_filter: true
            };
        }
    }

    // Stage 0c: Engineered facet-value filter buttons (no microstate required)
    // Value buttons emitted by product.search use: __filter:value:<attrCode>:<value>__
    // We re-run the last product.search with an exact attribute value filter and reset to page 1.
    if (engineeredEarly && engineeredEarly.namespace === 'filter' && engineeredEarly.command === 'value' && userId) {
        const last = state.product_context?.last_search;
        let baseFilters = last?.filters && typeof last.filters === 'object' ? last.filters : null;
        const arg = engineeredEarly.arg ? String(engineeredEarly.arg) : '';
        const parts = arg.split(':').filter(Boolean);
        let snapshotId = null;
        let attrCode = parts[0] || null;
        let value = parts.slice(1).join(':') || null;

        // Snapshot-aware value token: __filter:value:<snapshotId>:<attrCode>:<value>__
        if (parts.length >= 3) {
            snapshotId = parts[0] || null;
            attrCode = parts[1] || null;
            value = parts.slice(2).join(':') || null;
        }
        if (value) {
            try {
                value = decodeURIComponent(value);
            } catch (_) { }
        }

        if (snapshotId) {
            try {
                const snap = await stateManager.getSearchSnapshot(userId, snapshotId);
                if (snap?.filters && typeof snap.filters === 'object') {
                    baseFilters = snap.filters;
                }
            } catch (_) { }
        }

        if (baseFilters && attrCode && value) {
            const baseAttrs = (baseFilters.attributes && typeof baseFilters.attributes === 'object')
                ? baseFilters.attributes
                : {};

            return {
                intents: [],
                tools: [{
                    tool: 'product.search',
                    params: {
                        ...baseFilters,
                        page: 1,
                        attributes: {
                            ...baseAttrs,
                            [attrCode]: value
                        }
                    },
                    reason: 'Engineered facet value filter'
                }],
                isMultiIntent: false,
                corrections: { original: userMessage },
                resolutions: [],
                engineered_value_filter: true
            };
        }
    }

    // Stage 0d: Engineered product details buttons (no microstate required)
    // Product card "More info" uses: __product:details:<productId>__
    if (engineeredEarly && engineeredEarly.namespace === 'product' && engineeredEarly.command === 'details' && userId) {
        const productId = engineeredEarly.arg ? String(engineeredEarly.arg).trim() : null;
        if (productId) {
            return {
                intents: [],
                tools: [{
                    tool: 'product.getDetails',
                    params: { product_id: productId },
                    reason: 'Engineered product details'
                }],
                isMultiIntent: false,
                corrections: { original: userMessage },
                resolutions: [],
                engineered_product_details: true
            };
        }
    }

    // Stage 0e: Engineered product compare buttons (no microstate required)
    // Product details screen "Compare" uses: __product:compare:<productId>__
    // This opens product_compare microstate with the first product pre-filled.
    if (engineeredEarly && engineeredEarly.namespace === 'product' && engineeredEarly.command === 'compare' && userId) {
        const productId = engineeredEarly.arg ? String(engineeredEarly.arg).trim() : null;
        if (productId) {
            const msObj = {
                type: 'missing_products',
                intent: 'product_compare',
                sandbox: 'soft',
                boostScore: 10.0,
                params: {
                    products: [productId]
                },
                entities: [],
                options: [],
                validators: {},
                normalizers: {},
                breakthrough: null,
                fields: null,
                currentFieldIndex: 0,
                contract: {
                    maxMessages: 3,
                    messagesUsed: 0,
                    onFulfilled: ['products'],
                    onKeyword: ['cancel', 'nevermind', 'stop'],
                    escalation: null,
                    onFulfilledSpawn: null
                }
            };
            await stateManager.setMicrostate(userId, msObj);

            return {
                intents: [{ intentName: 'product_compare', score: 0, parameters: msObj.params }],
                tools: [{
                    tool: 'microstate.collect',
                    params: {
                        paramName: 'products',
                        message: 'What is the second product you want to compare with?',
                        hint: 'e.g., "Galaxy S24"'
                    },
                    reason: 'Compare: collect second product'
                }],
                isMultiIntent: false,
                corrections: { original: userMessage },
                resolutions: [],
                microstate_opened: true,
                engineered_product_compare: true
            };
        }
    }

    // Stage 0f: Engineered cart add buttons (no microstate required)
    // Product details screen "Add to cart" uses: __cart:add:<productId>__
    if (engineeredEarly && engineeredEarly.namespace === 'cart' && engineeredEarly.command === 'add' && userId) {
        const productId = engineeredEarly.arg ? String(engineeredEarly.arg).trim() : null;
        if (productId) {
            return {
                intents: [],
                tools: [{
                    tool: 'cart.add',
                    params: { product_id: productId },
                    reason: 'Engineered add to cart'
                }],
                isMultiIntent: false,
                corrections: { original: userMessage },
                resolutions: [],
                engineered_cart_add: true
            };
        }
    }

    // Stage 0g: Engineered cart/view + checkout + continue shopping buttons
    // cart.add returns: __cart:view__ / __order:checkout__ / __shop:continue__
    if (engineeredEarly && userId) {
        if (engineeredEarly.namespace === 'cart' && engineeredEarly.command === 'view') {
            return {
                intents: [],
                tools: [{ tool: 'cart.view', params: {}, reason: 'Engineered view cart' }],
                isMultiIntent: false,
                corrections: { original: userMessage },
                resolutions: [],
                engineered_cart_view: true
            };
        }

        if (engineeredEarly.namespace === 'order' && engineeredEarly.command === 'checkout') {
            return {
                intents: [],
                tools: [{ tool: 'order.checkout', params: {}, reason: 'Engineered checkout' }],
                isMultiIntent: false,
                corrections: { original: userMessage },
                resolutions: [],
                engineered_checkout: true
            };
        }

        if (engineeredEarly.namespace === 'shop' && engineeredEarly.command === 'continue') {
            const last = state.product_context?.last_search;
            const baseFilters = last?.filters && typeof last.filters === 'object' ? last.filters : null;
            if (baseFilters) {
                return {
                    intents: [],
                    tools: [{ tool: 'product.search', params: { ...baseFilters }, reason: 'Engineered continue shopping (repeat last search)' }],
                    isMultiIntent: false,
                    corrections: { original: userMessage },
                    resolutions: [],
                    engineered_continue_shopping: true
                };
            }

            return {
                intents: [],
                tools: [{ tool: 'product.search', params: { query: 'popular', limit: 5 }, reason: 'Engineered continue shopping (default browse)' }],
                isMultiIntent: false,
                corrections: { original: userMessage },
                resolutions: [],
                engineered_continue_shopping: true
            };
        }
    }

    // Stage 0h: Engineered vendor buttons (no microstate required)
    // vendor.getInfo returns: __vendor:products:<vendorKey>__ / __vendor:contact:<vendorKey>__
    // product.getDetails returns: __vendor:info:<vendorKey>__
    if (engineeredEarly && userId && engineeredEarly.namespace === 'vendor') {
        const vendorKeyRaw = engineeredEarly.arg ? String(engineeredEarly.arg).trim() : null;
        let vendorKey = vendorKeyRaw;
        if (vendorKey) {
            const decodeBase64Url = (s) => {
                const clean = String(s || '').replace(/-/g, '+').replace(/_/g, '/');
                const pad = clean.length % 4 === 0 ? '' : '='.repeat(4 - (clean.length % 4));
                return Buffer.from(clean + pad, 'base64').toString('utf8');
            };
            // Prefer base64url decoding (WhatsApp-safe). Fallback to decodeURIComponent for legacy tokens.
            try {
                vendorKey = decodeBase64Url(vendorKey);
            } catch (_) {
                try {
                    vendorKey = decodeURIComponent(vendorKey);
                } catch (_) { }
            }
        }

        if (engineeredEarly.command === 'products' && vendorKey) {
            return {
                intents: [],
                tools: [{ tool: 'vendor.getProducts', params: { vendor: vendorKey }, reason: 'Engineered vendor products' }],
                isMultiIntent: false,
                corrections: { original: userMessage },
                resolutions: [],
                engineered_vendor_products: true
            };
        }

        if (engineeredEarly.command === 'contact' && vendorKey) {
            return {
                intents: [],
                tools: [{ tool: 'vendor.getContactLink', params: { vendor: vendorKey }, reason: 'Engineered vendor contact' }],
                isMultiIntent: false,
                corrections: { original: userMessage },
                resolutions: [],
                engineered_vendor_contact: true
            };
        }

        if (engineeredEarly.command === 'info' && vendorKey) {
            return {
                intents: [],
                tools: [{ tool: 'vendor.getInfo', params: { vendor: vendorKey }, reason: 'Engineered vendor info' }],
                isMultiIntent: false,
                corrections: { original: userMessage },
                resolutions: [],
                engineered_vendor_info: true
            };
        }
    }

    // ═══════════════════════════════════════════════
    // Stage 0: CHECK ACTIVE MICROSTATE
    // If a microstate is open, it processes the message FIRST.
    // If handled → return directly (bypasses all other stages).
    // If not handled (breakthrough) → fall through to normal pipeline.
    // ═══════════════════════════════════════════════
    const activeMicrostate = await stateManager.getMicrostate(userId);
    if (activeMicrostate) {
        logDebug('PIPELINE:STAGE0_MICROSTATE', {
            _desc: 'Get active microstate — flow in progress (ordinal choice, checkout, etc.)',
            _example: 'User in "pick one" flow → microstate.type: ordinal_choice',
            type: activeMicrostate.type,
            intent: activeMicrostate.intent,
            sandbox: activeMicrostate.sandbox,
            messagesUsed: activeMicrostate.contract.messagesUsed,
            confidence: activeMicrostate.confidence
        });

        const msResult = await microstateRunner.run(userMessage, activeMicrostate, state, storeContext);

        if (msResult.handled) {
            logDebug('PIPELINE:STAGE0_HANDLED', {
                _desc: 'Microstate consumed message — fulfilled, escalated, or reprompt',
                _example: 'User says "2" in ordinal choice → fulfilled, maps to tool',
                type: activeMicrostate.type,
                result: msResult.result?.microstate_fulfilled ? 'fulfilled' :
                    msResult.result?.microstate_escalated ? 'escalated' :
                        msResult.result?.microstate_reprompt ? 'reprompt' : 'other'
            });
            return msResult.result;
        }

        logDebug('PIPELINE:STAGE0_BREAKTHROUGH', {
            _desc: 'Message broke through microstate sandbox — unrelated intent detected',
            _example: 'User in ordinal flow says "show me phones" → falls through to normal pipeline',
            type: activeMicrostate.type,
            reason: 'Message broke through soft sandbox'
        });
        // Clear stack on breakthrough - user is starting fresh
        await stateManager.clearStack(userId);
        // Fall through to normal pipeline
    }

    // Stage 1: Fuzzy correction (with Guards)
    const afterFuzzy = fuzzyMatcher.correctText(userMessage, storeContext);
    logDebug('PIPELINE:STAGE1_FUZZY', {
        _desc: 'Fuzzy typo correction — Levenshtein + entity guard',
        _example: '"add to crrt" → "add to cart"',
        original: userMessage,
        corrected: afterFuzzy,
        changed: userMessage !== afterFuzzy
    });

    // Stage 2: Context resolution (pronouns, ordinals, brand refs)
    const { resolvedText: afterContext, resolutions } = contextResolver.resolveReferences(afterFuzzy, state, storeContext);
    logDebug('PIPELINE:STAGE2_CONTEXT', {
        _desc: 'Reference resolution — pronouns/ordinals replaced from reference_map',
        _example: '"add the first one" → "add iPhone XS Max" (from ordinal_list)',
        input: afterFuzzy,
        resolved: afterContext,
        resolutions: resolutions,
        changed: afterFuzzy !== afterContext
    });

    // Stage 3: Preprocess (normalize, negate, split)
    const { statements, isMultiIntent } = preprocessor.preprocess(afterContext);
    logDebug('PIPELINE:STAGE3_PREPROCESS', {
        _desc: 'Preprocess — normalize, detect negation, split on conjunctions',
        _example: '"phones and laptops" → 2 statements; "dont want cheap" → negated: true',
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
            // Skip when pronoun is relative ("laptop that can") or temporal ("after that")
            if (singularRef) {
                for (const pronoun of SINGULAR_PRONOUNS) {
                    const regex = new RegExp(`\\b${pronoun.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
                    textForExtraction = textForExtraction.replace(regex, (matched, offset, fullString) => {
                        if (shouldSkipAmbiguousReference(fullString, offset, matched)) return matched;
                        return singularRef;
                    });
                }
            }
            if (pluralRef) {
                for (const pronoun of PLURAL_PRONOUNS) {
                    const regex = new RegExp(`\\b${pronoun.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
                    textForExtraction = textForExtraction.replace(regex, (matched, offset, fullString) => {
                        if (shouldSkipAmbiguousReference(fullString, offset, matched)) return matched;
                        return pluralRef;
                    });
                }
            }

            if (textForExtraction !== statement.text) {
                logDebug(`PIPELINE:STAGE3B_COREF [Statement ${i + 1}]`, {
                    _desc: 'Intra-query coreference — resolve pronouns in multi-statement using prev statement entities',
                    _example: '"add the first one" (stmt2) → "add iphone xs max" using stmt1 entities',
                    original: statement.text,
                    resolved: textForExtraction,
                    prevEntities: prevStatementEntities.map(e => e.type + ':' + (e.value || e.verb))
                });
            }
        }

        const cleanedText = cleanText(textForExtraction);
        logDebug(`PIPELINE:STAGE3C_NLP_CLEAN [Statement ${i + 1}]`, {
            _desc: 'NLP cleaning — remove adverbs, punctuation, normalize text',
            _example: '"Can you maybe please just show me, like, cheap phones???" → "show me cheap phones"',
            before: textForExtraction,
            after: cleanedText,
            changed: textForExtraction !== cleanedText
        });

        // Stage 4a: Entity Extraction
        const positionTracker = createPositionTracker();
        const extractionResult = extractEntities(cleanedText, storeContext, idfMap, positionTracker, resolutions);

        logDebug(`PIPELINE:STAGE4A_ENTITIES [Statement ${i + 1}/${statements.length}]`, {
            _desc: 'Entity extraction — vendors, categories, brands, actions, residual words',
            _example: '"add samsung phone to cart" → action:add, brand:samsung, residual:phone',
            text: cleanedText,
            entities: extractionResult.entities.map(e => ({
                type: e.type,
                value: e.value || e.verb,
                category: e.category,
                idf: e.idf,
                quality: e.quality,
                matchMeta: e.matchMeta,
                wordIndices: e.wordIndices,
                consumedWordIndices: e.consumedWordIndices
            })),
            residualWords: extractionResult.residualWords,
            categoryHints: extractionResult.categoryHints || []
        });

        // Stage 4b: Schema Resolution (replaces candidateDetector + intentScorer)
        const resolution = resolveIntent(extractionResult, cleanedText, idfMap, storeContext);
        logDebug(`PIPELINE:STAGE4B_SCHEMA [Statement ${i + 1}]`, {
            _desc: 'Schema resolution — score intents by param fit, IDF keywords, action verbs',
            _example: '"add drawer to cart" → add_to_cart 4.86, product_search 2.50',
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
                _desc: 'No intent matched — schema scorer found no positive candidates',
                _example: '"do the vibes" → no intent, skip statement',
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
            statement.text, candidates, aiQueryFn, storeContext, resolutions, extractionResult.entities
        );
        logDebug(`PIPELINE:STAGE5_PARAMS [Statement ${i + 1}]`, {
            _desc: 'Parameter extraction — map entities to intent slots, structural match, regex',
            _example: '"add 2 samsung phones" → product_name:samsung phones, quantity:2',
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
                logDebug(`PIPELINE:STAGE47_INTENT_INVERSION [Statement ${i + 1}]`, {
                    _desc: 'Intent inversion — negated statement flips intent via invertTo',
                    _example: '"dont add to cart" → add_to_cart inverted to remove_from_cart',
                    from: invertedFrom,
                    to: resolvedIntentName,
                    negated: statement.negated
                });
            }
        }

        // Stage 4c: Context Reconciliation (Delicate mapping)
        const reconciledStmt = contextReconciler.reconcile({
            intentName: resolvedIntentName,
            score: resolution.winner.score,
            parameters: mergedParams,
            matchedKeywords: resolution.winner.matchedKeywords,
            invertedFrom
        }, state, storeContext);

        resolvedStatements.push({
            ...reconciledStmt,
            extractedParams,
            statementText: statement.text,
            stage2Resolutions: resolutions
        });

        // [TEST] Residual chunk analysis — background, log-only, product_search with residuals
        runResidualChunkAnalysis({
            intentName: resolvedIntentName,
            productName: reconciledStmt.parameters?.product_name || mergedParams?.product_name || '',
            residualWords: extractionResult.residualWords,
            positionTracker,
            statementIndex: i + 1,
            originalText: statement.text
        });
    }

    // --- RULE 8: CLARIFICATION FALLBACK ---
    if (resolvedStatements.length === 0 && userMessage.length > 3) {
        logDebug('PIPELINE:RULE8_FALLBACK', {
            _desc: 'Clarification fallback — no intents resolved, return fallback_unknown + clarify',
            _example: '"do the vibes" → conversation.clarify asks user to rephrase',
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
    // Pass userId to portIntents for user_query_map access
    const portedStatements = await intentPorter.portIntents(resolvedStatements, { ...state, user_id: userId });
    logDebug('PIPELINE:STAGE7.5_PORTING', {
        _desc: 'Intent porting — pivot product_search → add_to_cart when product in reference_map + purchase verb',
        _example: '"i want to buy drawer" after search → add_to_cart (drawer resolved)',
        before: resolvedStatements.map(s => s.intentName),
        after: portedStatements.map(s => s.intentName)
    });

    // Stage 6: Cross-intent parameter bleeding
    const bledStatements = parameterBleeder.bleedParameters(portedStatements);
    logDebug('PIPELINE:STAGE6_BLEEDING', {
        _desc: 'Parameter bleeding — pass missing required params from earlier statements in multi-intent',
        _example: '"phones then add to cart" → add_to_cart gets product_name from product_search',
        before: portedStatements.map(s => ({ intent: s.intentName, params: s.parameters })),
        after: bledStatements.map(s => ({ intent: s.intentName, params: s.parameters, bledParams: s.bledParams }))
    });

    // Stage 6.5: Parameter Normalization
    const normalizedStatements = parameterNormalizer.normalizeParameters(bledStatements, storeContext);
    logDebug('PIPELINE:STAGE6.5_NORMALIZATION', {
        _desc: 'Parameter normalization — clause_words→attributes, vendor/category ID resolution',
        _example: '"the white ones" → attributes: { color: white }',
        normalized: normalizedStatements.map(s => ({ intent: s.intentName, params: s.parameters }))
    });

    // ═══════════════════════════════════════════════
    // Stage 7: INVENTORY CHECK + PARENTAL PIVOT
    // If a category has 0 products, flag it, suggest siblings, and pivot to parent.
    // ═══════════════════════════════════════════════
    for (const stmt of normalizedStatements) {
        if (!['product_search', 'check_availability', 'discovery_sentinel'].includes(stmt.intentName)) continue;

        const catId = stmt.parameters?.category;
        if (!catId) continue;

        const cat = findById(catId);
        if (!cat) continue;

        // Skip if category has products
        if (cat.total_count > 0) continue;

        logDebug('PIPELINE:STAGE7_INVENTORY_CHECK', {
            _desc: 'Inventory check — flag empty category, set _empty_category',
            _example: '"bedside drawer" in empty cat → _empty_category: true, suggest siblings',
            category: cat.label,
            total_count: cat.total_count,
            action: 'Category is empty, evaluating fallback options'
        });

        // Flag the empty category
        stmt.parameters._empty_category = true;
        stmt.parameters._empty_category_label = cat.label;

        // Suggest siblings with products (contextual alternatives)
        const siblings = getSiblings(catId)
            .filter(s => s.total_count > 0)
            .slice(0, 3);

        if (siblings.length > 0) {
            stmt.parameters._suggested_alternatives = siblings.map(s => ({
                label: s.label, id: s.id, count: s.total_count
            }));
            logDebug('PIPELINE:STAGE7_SIBLING_SUGGESTIONS', {
                _desc: 'Sibling suggestions — offer alternative categories with products',
                _example: 'empty Gaming Laptops → suggest Laptops (7), Electronics (3)',
                category: cat.label,
                siblings: siblings.map(s => `${s.label} (${s.total_count})`)
            });
        }

        // Parental Pivot: auto-broaden to parent if parent has products
        if (!isRoot(catId)) {
            const parent = getParent(catId);
            if (parent && parent.total_count > 0) {
                const path = getPath(catId);
                logDebug('PIPELINE:STAGE7_PARENTAL_PIVOT', {
                    _desc: 'Parental pivot — broaden to parent category when child is empty',
                    _example: 'Android Tablets empty → pivot to Tablets (parent has products)',
                    from: cat.label,
                    to: parent.label,
                    path,
                    parentCount: parent.total_count
                });
                stmt.parameters.category = parent.id;
                stmt.parameters._pivoted_from = cat.label;
                stmt.parameters._pivoted_to = parent.label;
                stmt.parameters._pivot_path = path;
            }
        }
    }

    // Build final intents array
    const intents = normalizedStatements.map(stmt => {
        const intent = {
            intentName: stmt.intentName,
            score: stmt.score,
            parameters: stmt.parameters,
            matchedKeywords: stmt.matchedKeywords,
            invertedFrom: stmt.invertedFrom,
            bledParams: stmt.bledParams || [],
            reconciledFromContext: stmt.reconciledFromContext || false,
            extractedParams: stmt.extractedParams || {},
            _ported_from: stmt._ported_from
        };
        // Debug: log ported intents
        if (intent._ported_from) {
            console.log(`[IntentResolver] ✅ Preserved _ported_from: ${intent.intentName} (from ${intent._ported_from})`);
        }
        return intent;
    });

    // ═══════════════════════════════════════════════
    // STACK: Execute intents sequentially
    // If multiple intents, execute one at a time and preserve remaining in stack
    // ═══════════════════════════════════════════════
    const stackResult = await stack.executeIntentStack(normalizedStatements, state, storeContext, state.session_id);

    // When stack is active, only process the FIRST intent
    // Remaining intents stay in stack for later
    let intentsToProcess = intents;
    if (stackResult.stack_active) {
        logDebug('PIPELINE:STACK_ACTIVATED', {
            _desc: 'STACK activated — only processing first intent, remaining deferred',
            currentIndex: stackResult.current_intent_index,
            totalIntents: stackResult.total_intents
        });
        // Only process first intent
        intentsToProcess = [intents[0]];
    }

    // ═══════════════════════════════════════════════
    // Stage 8a: SEARCH CONTEXT — Write & Read
    // Write: After search/discovery, capture semantic context.
    // Read: For cart/compare/availability, resolve references from context.
    // TTL: Decrement on every message.
    // ═══════════════════════════════════════════════
    const winnerIntent = intentsToProcess[0];
    if (userId) {
        // Always decrement TTL on every message
        await stateManager.decrementSearchContextTTL(userId);

        // ── WRITE: Search/discovery intents → capture context ──
        const WRITE_INTENTS = ['product_search', 'discovery_sentinel'];
        if (winnerIntent && WRITE_INTENTS.includes(winnerIntent.intentName)) {
            const params = winnerIntent.parameters || {};

            // Extract clean clause IDs for context index
            let clauses = params.clause_words || [];
            if (Array.isArray(clauses)) {
                clauses = clauses.map(c => typeof c === 'object' ? (c.clauseId || c.id || String(c)) : String(c));
            } else if (typeof clauses === 'object' && clauses !== null) {
                clauses = Object.keys(clauses);
            } else {
                clauses = [String(clauses)];
            }

            await stateManager.setSearchContext(userId, {
                category: params.category_name || params.category || null,
                category_id: params.category || null,
                vendor: params.vendor || null,
                vendor_id: params.vendor_id || null,
                clauses: clauses,
                attributes: params.attributes || {},
                product_ids: [], // Filled later by tool execution handler
                result_count: 0,
                query: params.product_name || params.query || userMessage,
                source_intent: winnerIntent.intentName
            });

            logDebug('PIPELINE:STAGE8A_CONTEXT_WRITE', {
                _desc: 'Search context write — store category, clauses, attributes for cart/compare later',
                _example: 'product_search "drawer" → context: { category, query, clauses }',
                intent: winnerIntent.intentName,
                category: params.category_name || params.category,
                clauses: params.clause_words, // Log original for debugging, context stores processed
                attributes: params.attributes
            });
        }

        // ── READ: Cart/compare/availability → resolve references ──
        // Process ALL intents, not just winnerIntent, especially ported ones
        const READ_INTENTS = ['add_to_cart', 'product_compare', 'check_availability'];
        const searchCtx = userId ? await stateManager.getSearchContext(userId) : null;

        if (searchCtx) {
            for (const intent of intents) {
                if (!READ_INTENTS.includes(intent.intentName)) continue;

                const params = intent.parameters || {};
                let contextApplied = false;

                // Grouped ordinal: "first two", "top two", "last three" → slice of search context product_ids
                if (searchCtx.product_ids.length > 0) {
                    let phraseStr = null;
                    const productsParam = params.products;
                    const singlePhrase = Array.isArray(productsParam) && productsParam.length === 1
                        ? productsParam[0]
                        : productsParam;
                    if (typeof singlePhrase === 'string') phraseStr = singlePhrase;
                    if (!phraseStr && params.product_name && typeof params.product_name === 'string') phraseStr = params.product_name;
                    // If params were rewritten by context (e.g. "first two" → "iphone xs max two"), extract from original message
                    if ((!phraseStr || !resolveGroupedOrdinal(phraseStr, searchCtx.product_ids.length)) && userMessage) {
                        const groupedMatch = userMessage.match(/\b(first|top|last)\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\b/i);
                        if (groupedMatch) phraseStr = groupedMatch[0];
                    }
                    if (phraseStr) {
                        const indices = resolveGroupedOrdinal(phraseStr, searchCtx.product_ids.length);
                        if (indices && indices.length > 0) {
                            const resolvedIds = indices.map(i => searchCtx.product_ids[i]);
                            params.products = resolvedIds;
                            params._context_product_ids = resolvedIds;
                            params._context_grouped_ordinal = phraseStr;
                            params._from_context = true;
                            params._context_source = searchCtx.source_intent;
                            params._context_query = searchCtx.query || '';
                            contextApplied = true;
                            logDebug('PIPELINE:STAGE8A_GROUPED_ORDINAL', {
                                _desc: 'Grouped ordinal — "first two", "top three" → slice of context product_ids',
                                _example: '"add first two to cart" → products: [id1, id2] from search context',
                                phrase: phraseStr,
                                listLength: searchCtx.product_ids.length,
                                indices,
                                productCount: resolvedIds.length
                            });
                        }
                    }
                }

                // Ordinal-choice microstate: bare "one"/"ones" in message OR unresolved/out-of-range ordinal
                if (!contextApplied && searchCtx.product_ids.length > 1) {
                    // Guard: if we already have a single concrete product resolved for add_to_cart
                    // (e.g. Stage2 reference resolution + porter set product_id/products), do NOT open ordinal_choice.
                    // This prevents cases like "the cheapest" → "<product name> one" from triggering ordinal_choice.
                    const hasConcreteSingleProduct = !!params.product_id ||
                        (Array.isArray(params.products) && params.products.length === 1 && typeof params.products[0] === 'string' && params.products[0].trim().length > 0);
                    if (hasConcreteSingleProduct && params._require_confirmation === true) {
                        // Keep contextApplied=false so later stages (microstate triggers) can run normally.
                    } else {
                        const msg = (userMessage || '').toLowerCase();
                        const hasOrdinalPrefix = /\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|twelvth|1st|2nd|3rd|4th|5th|6th|7th|8th|9th|10th|11th|12th|last)\s+(?:one|ones)\b/i.test(msg);
                        const hasBareOneInMessage = /\b(?:the\s+)?(one|ones)\b/i.test(msg) && !hasOrdinalPrefix;
                        let phraseForOrdinal = (params.products && params.products[0]) || params.product_name;
                        if (typeof phraseForOrdinal !== 'string') phraseForOrdinal = null;
                        const ordinalPhrase = phraseForOrdinal ? phraseForOrdinal.replace(/\s+(one|ones)$/i, '').trim() : null;
                        const oneBased = ordinalPhrase ? resolveOrdinal(ordinalPhrase) : null;
                        const listLen = searchCtx.product_ids.length;
                        const outOfRange = oneBased != null && oneBased !== -1 && oneBased > listLen;
                        const unresolvedOrdinal = phraseForOrdinal && /(one|ones)$/i.test(phraseForOrdinal) && (oneBased == null || outOfRange);
                        if (hasBareOneInMessage || unresolvedOrdinal) {
                            params._open_ordinal_choice_microstate = true;
                            params._ordinal_choice_product_ids = searchCtx.product_ids;
                            contextApplied = true;
                            logDebug('PIPELINE:STAGE8A_ORDINAL_CHOICE_TRIGGER', {
                                _desc: 'Ordinal choice trigger — bare "one"/"ones" with multiple results → ask which one',
                                _example: '"add one" with 5 products → open ordinal_choice microstate',
                                reason: hasBareOneInMessage ? 'bare_one_in_message' : 'unresolved_or_out_of_range_ordinal',
                                productCount: listLen,
                                phrase: phraseForOrdinal,
                                oneBased,
                                intent: intent.intentName
                            });
                        }
                    }
                }

                // Phase 3: Single ordinal — "first one", "second one", "the first one", "last one" → inject only that product ID
                if (!contextApplied && searchCtx.product_ids.length > 0) {
                    let oneBased = null;
                    let singleOrdinalPhrase = (params.products && params.products[0]) || params.product_name;
                    if (typeof singleOrdinalPhrase === 'string' && /(?:one|ones)$/i.test(singleOrdinalPhrase)) {
                        const ordPhrase = singleOrdinalPhrase.replace(/\s+(one|ones)$/i, '').trim();
                        oneBased = resolveOrdinal(ordPhrase);
                    }
                    if (oneBased == null && userMessage) {
                        const msgMatch = userMessage.match(/\b(the\s+)?(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last|1st|2nd|3rd|4th|5th|6th|7th|8th|9th|10th)\s+(?:one|ones)\b/i);
                        if (msgMatch) {
                            oneBased = resolveOrdinal(msgMatch[2].trim());
                            singleOrdinalPhrase = singleOrdinalPhrase || msgMatch[0];
                        }
                    }
                    const listLen = searchCtx.product_ids.length;
                    if (oneBased != null && oneBased >= 1 && oneBased <= listLen) {
                        const index = oneBased - 1;
                        const resolvedIds = [searchCtx.product_ids[index]];
                        params.products = resolvedIds;
                        params._context_product_ids = resolvedIds;
                        params._context_single_ordinal = singleOrdinalPhrase || `#${oneBased}`;
                        params._from_context = true;
                        params._context_source = searchCtx.source_intent;
                        params._context_query = searchCtx.query || '';
                        contextApplied = true;
                        logDebug('PIPELINE:STAGE8A_SINGLE_ORDINAL', {
                            _desc: 'Single ordinal — "first one", "the second one" → inject that product ID',
                            _example: '"add the first one" → products: [searchCtx.product_ids[0]]',
                            phrase: singleOrdinalPhrase,
                            oneBased,
                            productId: resolvedIds[0]
                        });
                    } else if (oneBased === -1 && listLen > 0) {
                        const resolvedIds = [searchCtx.product_ids[listLen - 1]];
                        params.products = resolvedIds;
                        params._context_product_ids = resolvedIds;
                        params._context_single_ordinal = singleOrdinalPhrase || 'last';
                        params._from_context = true;
                        params._context_source = searchCtx.source_intent;
                        params._context_query = searchCtx.query || '';
                        contextApplied = true;
                        logDebug('PIPELINE:STAGE8A_SINGLE_ORDINAL', {
                            _desc: 'Single ordinal — "last one" → inject last product ID',
                            _example: '"add the last one" → products: [searchCtx.product_ids[len-1]]',
                            phrase: singleOrdinalPhrase,
                            oneBased: 'last',
                            productId: resolvedIds[0]
                        });
                    }
                }

                // If user mentions a clause that matches search context (e.g., "the cheap ones")
                let userClauses = params.clause_words || [];
                if (!Array.isArray(userClauses)) {
                    if (typeof userClauses === 'object' && userClauses !== null) {
                        userClauses = Object.keys(userClauses);
                    } else if (userClauses) {
                        userClauses = [String(userClauses)];
                    } else {
                        userClauses = [];
                    }
                }

                // Ensure searchCtx.clauses is also an array before calling filter/includes
                const ctxClauses = Array.isArray(searchCtx.clauses) ? searchCtx.clauses : [];
                const matchedClauses = userClauses.filter(c => {
                    const cid = typeof c === 'object' ? (c.clauseId || c.id || String(c)) : String(c);
                    return ctxClauses.includes(cid);
                });

                // Detect explicit pronouns or reference words that imply context use
                const PRONOUNS = ['ones', 'one', 'it', 'them', 'that', 'this', 'those', 'these', 'the_one', 'the_ones', 'the_products'];
                const hasExplicitPronoun = (params.product_name && PRONOUNS.includes(params.product_name.toLowerCase())) ||
                    (params.products && params.products.some(p => PRONOUNS.includes(p.toLowerCase())));

                // Clause match: trigger if matchedClauses exist OR if we have params.attributes for filtering
                // (e.g., "add the white ones" when searchCtx.clauses is empty but params.attributes.color exists)
                if (!contextApplied && searchCtx.product_ids.length > 0 &&
                    (matchedClauses.length > 0 || (params.attributes && Object.keys(params.attributes).length > 0 && searchCtx.product_attributes_map))) {
                    let filteredProductIds = searchCtx.product_ids;

                    console.log(`[Stage8a:ClauseMatch] 🔍 Starting clause match filtering:`, {
                        matchedClauses: matchedClauses,
                        params_attributes: params.attributes,
                        searchCtx_attributes: searchCtx.attributes,
                        product_ids_before: searchCtx.product_ids.length,
                        product_attributes_map_exists: !!searchCtx.product_attributes_map,
                        product_attributes_map_keys: searchCtx.product_attributes_map ? Object.keys(searchCtx.product_attributes_map) : []
                    });

                    // Filter by attributes if params.attributes exists (from parameterNormalizer mapping clause_words)
                    // This ensures "add the white ones" only adds products that actually have color: 'white'
                    if (params.attributes && Object.keys(params.attributes).length > 0 && searchCtx.product_attributes_map) {
                        // product_attributes_map uses API codes (c, b, p); params use human keys (color, brand, price_tier)
                        const attrKeyToCode = {};
                        if (storeContext.ATTRIBUTES) {
                            Object.entries(storeContext.ATTRIBUTES).forEach(([key, attr]) => {
                                if (attr?.code) {
                                    attrKeyToCode[key] = attr.code;
                                    if (attr?.label && attr.label !== key) attrKeyToCode[attr.label] = attr.code;
                                }
                            });
                        }
                        const filterResults = [];
                        filteredProductIds = searchCtx.product_ids.filter(pid => {
                            const productAttrs = searchCtx.product_attributes_map[pid];
                            if (!productAttrs) {
                                filterResults.push({ pid, reason: 'no_attributes_stored', kept: true });
                                return true; // Keep if no attributes stored (fallback)
                            }

                            // Check if product matches all params.attributes (try attrKey then code, no key stripping)
                            let matches = true;
                            for (const [attrKey, attrValue] of Object.entries(params.attributes)) {
                                const productAttrValue = productAttrs[attrKey] ?? (attrKeyToCode[attrKey] ? productAttrs[attrKeyToCode[attrKey]] : undefined);
                                const productAttrStr = productAttrValue ? String(productAttrValue).toLowerCase() : null;
                                const expectedAttrStr = String(attrValue).toLowerCase();

                                if (!productAttrValue || productAttrStr !== expectedAttrStr) {
                                    matches = false;
                                    filterResults.push({
                                        pid,
                                        attrKey,
                                        productAttrValue: productAttrValue || '(missing)',
                                        expectedAttrValue: attrValue,
                                        reason: !productAttrValue ? 'attribute_missing' : 'attribute_mismatch',
                                        kept: false
                                    });
                                    break;
                                }
                            }

                            if (matches) {
                                filterResults.push({ pid, reason: 'all_attributes_match', kept: true });
                            }
                            return matches;
                        });

                        console.log(`[Stage8a:ClauseMatch] 🔍 Filtering results:`, {
                            before: searchCtx.product_ids.length,
                            after: filteredProductIds.length,
                            filtered_out: searchCtx.product_ids.length - filteredProductIds.length,
                            filter_details: filterResults
                        });

                        if (filteredProductIds.length === 0) {
                            // If filtering removed all products, fallback to original (better than nothing)
                            console.log(`[Stage8a:ClauseMatch] ⚠️ Filtering removed all products, falling back to original`);
                            filteredProductIds = searchCtx.product_ids;
                        }
                    } else {
                        console.log(`[Stage8a:ClauseMatch] ⏭️ Skipping attribute filter:`, {
                            has_params_attributes: !!(params.attributes && Object.keys(params.attributes).length > 0),
                            has_product_attributes_map: !!searchCtx.product_attributes_map
                        });
                    }

                    params._context_product_ids = filteredProductIds;
                    if (matchedClauses.length > 0) {
                        params._context_matched_clauses = matchedClauses;
                    } else {
                        // No clause match, but we filtered by attributes
                        params._context_matched_attributes = params.attributes;
                    }
                    contextApplied = true;
                }

                // If user mentions same category from context (e.g., "the phones")
                else if (!contextApplied && params.category && searchCtx.category_id &&
                    params.category === searchCtx.category_id && searchCtx.product_ids.length > 0) {
                    params._context_product_ids = searchCtx.product_ids;
                    params._context_matched_category = searchCtx.category;
                    contextApplied = true;
                }

                // If user mentions an attribute matching context (e.g., "the white ones")
                // Also works when params.attributes exists but searchCtx.attributes is empty (filter by product_attributes_map)
                else if (!contextApplied && params.attributes && Object.keys(params.attributes).length > 0 && searchCtx.product_ids.length > 0) {
                    // If searchCtx.attributes exists, match against it; otherwise use params.attributes directly for filtering
                    const matchedAttrs = {};
                    if (searchCtx.attributes && Object.keys(searchCtx.attributes).length > 0) {
                        for (const [key, val] of Object.entries(params.attributes)) {
                            if (searchCtx.attributes[key] === val) {
                                matchedAttrs[key] = val;
                            }
                        }
                    } else {
                        // No searchCtx.attributes, use params.attributes directly for filtering
                        Object.assign(matchedAttrs, params.attributes);
                    }

                    if (Object.keys(matchedAttrs).length > 0) {
                        let filteredProductIds = searchCtx.product_ids;

                        // Filter products by matched attributes using product_attributes_map
                        if (searchCtx.product_attributes_map) {
                            const attrKeyToCode = {};
                            if (storeContext.ATTRIBUTES) {
                                Object.entries(storeContext.ATTRIBUTES).forEach(([key, attr]) => {
                                    if (attr?.code) {
                                        attrKeyToCode[key] = attr.code;
                                        if (attr?.label && attr.label !== key) attrKeyToCode[attr.label] = attr.code;
                                    }
                                });
                            }
                            filteredProductIds = searchCtx.product_ids.filter(pid => {
                                const productAttrs = searchCtx.product_attributes_map[pid];
                                if (!productAttrs) return true; // Keep if no attributes stored (fallback)

                                for (const [attrKey, attrValue] of Object.entries(matchedAttrs)) {
                                    const productAttrValue = productAttrs[attrKey] ?? (attrKeyToCode[attrKey] ? productAttrs[attrKeyToCode[attrKey]] : undefined);
                                    const productAttrStr = productAttrValue ? String(productAttrValue).toLowerCase() : null;
                                    const expectedStr = String(attrValue).toLowerCase();
                                    if (!productAttrValue || productAttrStr !== expectedStr) {
                                        return false; // Attribute missing or doesn't match
                                    }
                                }
                                return true; // All attributes match
                            });

                            if (filteredProductIds.length === 0) {
                                filteredProductIds = searchCtx.product_ids; // Fallback
                            }
                        }

                        params._context_product_ids = filteredProductIds;
                        params._context_matched_attributes = matchedAttrs;
                        contextApplied = true;
                    }
                }

                // FALLBACK: If explicit pronoun used, always inject context products if available
                // BUT: Filter by attributes if params.attributes exists (e.g., "add the white ones")
                else if (!contextApplied && hasExplicitPronoun && searchCtx.product_ids.length > 0) {
                    let filteredProductIds = searchCtx.product_ids;

                    console.log(`[Stage8a:PronounFallback] 🔍 Starting pronoun fallback with attribute filtering:`, {
                        hasExplicitPronoun: hasExplicitPronoun,
                        params_attributes: params.attributes,
                        product_ids_before: searchCtx.product_ids.length,
                        product_attributes_map_exists: !!searchCtx.product_attributes_map
                    });

                    // Filter by attributes if params.attributes exists (from parameterNormalizer)
                    if (params.attributes && Object.keys(params.attributes).length > 0 && searchCtx.product_attributes_map) {
                        const attrKeyToCode = {};
                        if (storeContext.ATTRIBUTES) {
                            Object.entries(storeContext.ATTRIBUTES).forEach(([key, attr]) => {
                                if (attr?.code) {
                                    attrKeyToCode[key] = attr.code;
                                    if (attr?.label && attr.label !== key) attrKeyToCode[attr.label] = attr.code;
                                }
                            });
                        }
                        const filterResults = [];
                        filteredProductIds = searchCtx.product_ids.filter(pid => {
                            const productAttrs = searchCtx.product_attributes_map[pid];
                            if (!productAttrs) {
                                filterResults.push({ pid, reason: 'no_attributes_stored', kept: true });
                                return true; // Keep if no attributes stored (fallback)
                            }

                            let matches = true;
                            for (const [attrKey, attrValue] of Object.entries(params.attributes)) {
                                const productAttrValue = productAttrs[attrKey] ?? (attrKeyToCode[attrKey] ? productAttrs[attrKeyToCode[attrKey]] : undefined);
                                const productAttrStr = productAttrValue ? String(productAttrValue).toLowerCase() : null;
                                const expectedAttrStr = String(attrValue).toLowerCase();

                                if (!productAttrValue || productAttrStr !== expectedAttrStr) {
                                    matches = false;
                                    filterResults.push({
                                        pid,
                                        attrKey,
                                        productAttrValue: productAttrValue || '(missing)',
                                        expectedAttrValue: attrValue,
                                        reason: !productAttrValue ? 'attribute_missing' : 'attribute_mismatch',
                                        kept: false
                                    });
                                    break;
                                }
                            }

                            if (matches) {
                                filterResults.push({ pid, reason: 'all_attributes_match', kept: true });
                            }
                            return matches;
                        });

                        console.log(`[Stage8a:PronounFallback] 🔍 Filtering results:`, {
                            before: searchCtx.product_ids.length,
                            after: filteredProductIds.length,
                            filtered_out: searchCtx.product_ids.length - filteredProductIds.length,
                            filter_details: filterResults
                        });

                        if (filteredProductIds.length === 0) {
                            console.log(`[Stage8a:PronounFallback] ⚠️ Filtering removed all products, falling back to original`);
                            filteredProductIds = searchCtx.product_ids; // Fallback
                        }
                    }

                    // Ordinal-choice microstate: multiple results + bare "one"/"ones" → ask which one
                    const rawProducts = params.products;
                    const rawName = params.product_name;
                    const isBareOne = (Array.isArray(rawProducts) && rawProducts.length === 1 &&
                        ['one', 'ones'].includes(String(rawProducts[0]).toLowerCase().trim())) ||
                        ['one', 'ones'].includes(String(rawName || '').toLowerCase().trim());
                    if (isBareOne && filteredProductIds.length > 1) {
                        params._open_ordinal_choice_microstate = true;
                        params._ordinal_choice_product_ids = filteredProductIds;
                        logDebug('PIPELINE:STAGE8A_ORDINAL_CHOICE', {
                            _desc: 'Ordinal choice — "ones" with multiple filtered results → open disambiguate',
                            _example: '"add the white ones" (3 matches) → ordinal_choice microstate',
                            productCount: filteredProductIds.length,
                            intent: intent.intentName
                        });
                    } else {
                        params._context_product_ids = filteredProductIds;
                        params._context_matched_pronoun = true;
                        contextApplied = true;
                    }
                }

                if (contextApplied) {
                    params._from_context = true;
                    params._context_source = searchCtx.source_intent;
                    params._context_query = searchCtx.query || '';

                    // If we have context product IDs, inject them into the main 'products' parameter
                    // to leverage the toolMapper's expansion logic (Phase 8b).
                    if (params._context_product_ids && params._context_product_ids.length > 0) {
                        // Guard: do NOT overwrite a confirmation-gated single-product add.
                        // (e.g. Stage2 resolved "the cheapest" → productId, porter set product_id/products)
                        const hasConcreteSingleProduct = !!params.product_id ||
                            (Array.isArray(params.products) && params.products.length === 1 && typeof params.products[0] === 'string' && params.products[0].trim().length > 0);
                        if (!(params._require_confirmation === true && hasConcreteSingleProduct)) {
                            params.products = params._context_product_ids;
                        }

                        // Filter out pronouns from products array (e.g., "ones", "white ones")
                        const PRONOUNS = ['ones', 'one', 'it', 'them', 'that', 'this', 'those', 'these', 'the_one', 'the_ones', 'the_products'];
                        params.products = params.products.filter(p => {
                            const pLower = String(p).toLowerCase();
                            // Remove if it's a pure pronoun or contains only pronoun
                            return !PRONOUNS.includes(pLower) && !PRONOUNS.some(pronoun => pLower === pronoun || pLower.endsWith(' ' + pronoun));
                        });

                        // Clear product_name if it's a pronoun
                        if (params.product_name && PRONOUNS.includes(params.product_name.toLowerCase())) {
                            params.product_name = null;
                        }

                        logDebug('PIPELINE:STAGE8A_CONTEXT_INJECT', {
                            _desc: 'Context inject — inject _context_product_ids into params.products',
                            _example: '"add the cheap ones" → products: [uuid1, uuid2] from clause match',
                            targetIntent: intent.intentName,
                            productCount: params.products.length,
                            reason: params._context_matched_clauses ? 'matched_clauses' :
                                params._context_matched_category ? 'matched_category' : 'matched_attributes'
                        });
                    }

                    intent.parameters = params;

                    logDebug('PIPELINE:STAGE8A_CONTEXT_READ', {
                        _desc: 'Search context read — resolve cart/compare refs from last search',
                        _example: 'add_to_cart "it" → load product_ids from searchCtx, match clauses/attrs',
                        intent: intent.intentName,
                        contextCategory: searchCtx.category,
                        contextClauses: searchCtx.clauses,
                        matchedClauses: params._context_matched_clauses,
                        matchedCategory: params._context_matched_category,
                        matchedAttributes: params._context_matched_attributes,
                        productIds: (params._context_product_ids || []).length
                    });
                }
            }
        }
    }

    // ── Stage 8a-cart: remove_from_cart — resolve "second item", "first item", "first two" → cart_item_id(s) ──
    if (winnerIntent && winnerIntent.intentName === 'remove_from_cart') {
        const params = winnerIntent.parameters || {};
        const products = params.products;
        let phraseStr = null;
        if (Array.isArray(products) && products.length === 1 && typeof products[0] === 'string') {
            phraseStr = products[0];
        } else if (params.product_name && typeof params.product_name === 'string') {
            phraseStr = params.product_name;
        }
        if (phraseStr && userId) {
            const state = await stateManager.getState(userId);
            const cartItems = state.cart?.items;
            if (cartItems && Array.isArray(cartItems) && cartItems.length > 0) {
                // Try grouped ordinal first: "first two", "top two", "last three"
                const groupedIndices = resolveGroupedOrdinal(phraseStr, cartItems.length);
                if (groupedIndices && groupedIndices.length > 0) {
                    params.products = groupedIndices.map(i => cartItems[i].id);
                    delete params.cart_item_id;
                    logDebug('PIPELINE:STAGE8A_CART_GROUPED_ORDINAL', {
                        _desc: 'Cart grouped ordinal — "first two items" → remove those cart_item_ids',
                        _example: '"remove first two" → products: [cart_items[0].id, cart_items[1].id]',
                        phrase: phraseStr,
                        indices: groupedIndices,
                        count: params.products.length
                    });
                } else {
                    // Single ordinal: "second item", "first item", "last item"
                    const ordinalPhrase = phraseStr.replace(/\s+item(s)?$/i, '').trim();
                    const oneBased = resolveOrdinal(ordinalPhrase);
                    if (oneBased != null) {
                        const index = oneBased === -1 ? cartItems.length - 1 : oneBased - 1;
                        if (index >= 0 && index < cartItems.length) {
                            params.cart_item_id = cartItems[index].id;
                            params.products = [];
                            logDebug('PIPELINE:STAGE8A_CART_ORDINAL', {
                                _desc: 'Cart single ordinal — "second item" → resolve to cart_item_id',
                                _example: '"remove the second item" → cart_item_id: cart_items[1].id',
                                phrase: phraseStr,
                                ordinal: oneBased,
                                cart_item_id: params.cart_item_id
                            });
                        }
                    }
                }
            }
        }
    }

    // ── Open ordinal-choice microstate when "one"/"ones" with multiple results ──
    if (winnerIntent && winnerIntent.parameters && winnerIntent.parameters._open_ordinal_choice_microstate && userId) {
        const ids = winnerIntent.parameters._ordinal_choice_product_ids || [];
        const count = ids.length;
        const message = count <= 5
            ? `You have ${count} options. Which one do you want? Reply with the number (1 to ${count}) or say "the first one", "the second one", etc.`
            : `You have ${count} options. Which one do you want? Reply with a number (1 to ${count}) or say "the first one", "the second one", etc.`;
        const msObj = {
            type: 'ordinal_choice',
            intent: winnerIntent.intentName,
            sandbox: 'soft',
            boostScore: 10.0,
            params: {
                ...winnerIntent.parameters,
                _ordinal_choice_product_ids: ids
            },
            entities: [],
            options: [],
            validators: {},
            normalizers: {},
            breakthrough: null,
            fields: null,
            currentFieldIndex: 0,
            contract: {
                maxMessages: 3,
                messagesUsed: 0,
                onFulfilled: ['products'],
                onKeyword: ['cancel', 'nevermind', 'stop'],
                escalation: null,
                onFulfilledSpawn: null
            }
        };
        await stateManager.setMicrostate(userId, msObj);
        logDebug('PIPELINE:ORDINAL_CHOICE_MICROSTATE_OPENED', {
            _desc: 'Ordinal choice microstate opened — ask user to pick by number',
            _example: '"add one" (5 options) → "Which one? Reply 1-5 or the first one"',
            intent: winnerIntent.intentName,
            productCount: count
        });
        return {
            intents,
            tools: [{
                tool: 'microstate.disambiguate',
                params: {
                    reason: 'ordinal_choice',
                    message,
                    parentIntent: winnerIntent.intentName,
                    options: ids.map((id, i) => ({ value: id, label: `${i + 1}. Option ${i + 1}` }))
                },
                reason: 'Ordinal choice: pick which option'
            }],
            isMultiIntent: false,
            corrections: { original: userMessage, afterFuzzy, afterContext },
            resolutions,
            microstate_opened: true
        };
    }

    // Stage 8b: Map intents to tool calls
    const tools = toolMapper.mapToTools(intentsToProcess.map(i => ({
        intentName: i.intentName,
        parameters: i.parameters || {},
        _ported_from: i._ported_from // Preserve _ported_from for tool mapping
    })));

    logDebug('PIPELINE:STAGE8_TOOL_MAPPING', {
        _desc: 'Tool mapping — map intents to tool calls via paramMap, expand product arrays',
        _example: 'add_to_cart → cart.add; product_search → product.search',
        intents: intentsToProcess.map(i => ({ intent: i.intentName, score: i.score, params: i.parameters })),
        tools: tools.map(t => ({ tool: t.tool, params: t.params, reason: t.reason }))
    });



    // ═══════════════════════════════════════════════
    // Stage 10: CHECK MICROSTATE TRIGGERS
    // After pipeline produces winner, check if it triggers a new microstate.
    // If triggered → open microstate, return prompt tool instead of original.
    // ═══════════════════════════════════════════════
    const winner = intentsToProcess[0];
    if (winner && userId) {
        const entities = extractEntities(cleanText(userMessage), storeContext, idfMap).entities;
        const triggered = microstateRegistry.checkTriggers(
            winner.intentName,
            winner.parameters,
            entities
        );

        if (triggered) {
            const msObj = triggered.buildMicrostate(winner);

            // Special UX: compare microstate should open with 5 recommended products + More/Cancel buttons.
            if (winner.intentName === 'product_compare' && triggered.triggerName === 'missing_products') {
                try {
                    const cats = Object.values(storeContext?.CATEGORIES || {})
                        .filter(c => (c?.total_count || 0) > 0 && c?.slug)
                        .map(c => c.slug);
                    const seedCategories = cats.sort(() => Math.random() - 0.5).slice(0, 6);
                    const categorySlug = seedCategories[0] || null;

                    if (categorySlug) {
                        const searchParams = new URLSearchParams({
                            category: String(categorySlug),
                            per_page: '5',
                            page: '1'
                        });
                        const result = await callBackendAPI(`/search/products?${searchParams.toString()}`);
                        if (result?.success) {
                            const rawProducts = result?.data?.products || result?.data?.results || [];
                            const products = await processProductList(rawProducts);
                            const options = (products || [])
                                .map(p => {
                                    const id = p?.id || p?.handle || p?.product_id;
                                    const label = p?.name || p?.title;
                                    if (!id || !label) return null;
                                    return { label: String(label), value: String(id), price: p?.price || p?.price_display || undefined };
                                })
                                .filter(Boolean);

                            msObj.options = options;
                            msObj.params = {
                                ...(msObj.params || {}),
                                _compare_rec: {
                                    phase: 'seed',
                                    seedCategories,
                                    seedIndex: 0,
                                    categorySlug,
                                    page: 1
                                }
                            };
                        }
                    }
                } catch (_) { }
            }

            await stateManager.setMicrostate(userId, msObj);

            logDebug('PIPELINE:STAGE10_MICROSTATE_OPENED', {
                _desc: 'Microstate trigger — intent matched trigger, open microstate instead of tool',
                _example: 'remove_from_cart with many items → ordinal_choice "Which item?"',
                triggerName: triggered.triggerName,
                intent: winner.intentName,
                sandbox: msObj.sandbox,
                onFulfilled: msObj.contract.onFulfilled
            });

            const openedPrompt = (winner.intentName === 'product_compare' && triggered.triggerName === 'missing_products')
                ? {
                    tool: 'microstate.disambiguate',
                    params: {
                        reason: 'compare_recommendations',
                        message: (() => {
                            const fallback = triggered.prompt?.params?.message || 'Which products would you like to compare?';
                            const slug = msObj?.params?._compare_rec?.categorySlug;
                            if (slug) {
                                return `Here are some suggestions from **${slug}**. You can also type any product name to compare:`;
                            }
                            return `${fallback} (You can also type any product name — these are just suggestions.)`;
                        })(),
                        parentIntent: winner.intentName,
                        options: msObj.options || [],
                        controls: { more: true, cancel: true, recommendedIndex: 0 },
                        missingParam: 'products'
                    },
                    reason: 'Compare: recommended products'
                }
                : triggered.prompt;

            // Enrich confirm prompts (e.g. Stage2 porting confirm_add_ported) with product context when available.
            if (openedPrompt && openedPrompt.tool === 'microstate.confirm') {
                const ctx = msObj?.params?._confirm_context;
                if (ctx && typeof ctx === 'object') {
                    openedPrompt.params = {
                        ...(openedPrompt.params || {}),
                        context: ctx
                    };

                    const productLabel = ctx.product ? String(ctx.product) : null;
                    if (productLabel && typeof openedPrompt?.params?.question === 'string') {
                        openedPrompt.params.question = `Add **${productLabel}** to your cart?`;
                    }
                }
            }

            return {
                intents,
                tools: [openedPrompt],
                isMultiIntent: false,
                corrections: {
                    original: userMessage,
                    afterFuzzy,
                    afterContext
                },
                resolutions,
                microstate_opened: true
            };
        }
    }

    return {
        intents: intentsToProcess,
        tools,
        isMultiIntent: stackResult.stack_active ? true : isMultiIntent,
        corrections: {
            original: userMessage,
            afterFuzzy,
            afterContext
        },
        resolutions,
        stack_active: stackResult.stack_active || false,
        stack_remaining: stackResult.stack_active ? stackResult.total_intents - 1 : 0
    };
}

module.exports = { resolveAndMap };
