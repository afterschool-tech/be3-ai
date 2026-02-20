/**
 * Pipeline Stage 0: Microstate Runner
 * 
 * Sandbox executor for active microstates. When a microstate is open,
 * incoming messages are processed HERE first before the normal pipeline.
 * 
 * The runner:
 *  1. Checks termination keywords
 *  2. Runs response utilities (yes/no, ordinal, selection)
 *  3. Runs entity extraction on the new message
 *  4. Merges new entities into microstate params
 *  5. Checks fulfillment contract
 *  6. If soft sandbox: allows pipeline breakthrough for unrelated intents
 * 
 * Returns: { handled: boolean, result: object|null }
 *   - handled=true  → microstate consumed the message, return result directly
 *   - handled=false → message broke through the sandbox, run normal pipeline
 */

const { extractEntities } = require('./entityExtractor');
const { resolveIntent } = require('./schemaResolver');
const { resolveYesNo, resolveOrdinal, resolveSelection, resolveMultiSelection, isTerminationKeyword } = require('../../../utils/responseResolver');
const { logDebug } = require('../../../utils/debugLogger');
const stateManager = require('../../../state/stateManager');
const intentRegistry = require('../config/intentRegistry');
const toolMapper = require('./toolMapper');
const parameterNormalizer = require('./parameterNormalizer');
const { cleanText } = require('./nlpCleaner');

// IDF map for entity extraction (loaded once)
let idfMap = null;
function getIdfMap() {
    if (!idfMap) idfMap = intentRegistry.buildIdfMap();
    return idfMap;
}

/**
 * Main entry point: process a message within an active microstate sandbox.
 * 
 * @param {string} userMessage - Raw user message
 * @param {object} microstate - Active microstate from stateManager
 * @param {object} state - Full user state
 * @param {object} storeContext - Store context (categories, vendors, etc.)
 * @returns {{ handled: boolean, result: object|null }}
 */
async function run(userMessage, microstate, state, storeContext) {
    const userId = state.user_id;
    const cleanedText = cleanText(userMessage).toLowerCase().trim();

    logDebug('MICROSTATE:RUNNER_ENTER', {
        _desc: 'Microstate runner enter — process message in active microstate sandbox',
        _example: 'ordinal_choice active → run termination, response analysis, fulfillment',
        id: microstate.id,
        type: microstate.type,
        intent: microstate.intent,
        sandbox: microstate.sandbox,
        messagesUsed: microstate.contract.messagesUsed,
        maxMessages: microstate.contract.maxMessages,
        confidence: microstate.confidence
    });

    // ── Step 1: Check termination keywords ──
    if (isTerminationKeyword(cleanedText, microstate.contract.onKeyword)) {
        logDebug('MICROSTATE:TERMINATED', {
            _desc: 'Microstate termination — user said cancel/stop keyword',
            _example: '"cancel" → clear microstate, escalate or fall through',
            reason: 'keyword',
            keyword: cleanedText
        });
        console.log(`[MicrostateRunner] ❌ Terminated by keyword: "${cleanedText}"`);

        // Check escalation
        const escalation = microstate.contract.escalation;
        await stateManager.clearMicrostate(userId);

        if (escalation) {
            // Port to escalation intent
            const tools = toolMapper.mapToTools([{
                intentName: escalation,
                parameters: microstate.params
            }]);
            return {
                handled: true,
                result: {
                    intents: [{ intentName: escalation, score: 0, parameters: microstate.params }],
                    tools,
                    isMultiIntent: false,
                    corrections: { original: userMessage },
                    microstate_escalated: true
                }
            };
        }

        // No escalation — just clear and let normal pipeline handle
        return { handled: false, result: null };
    }

    // ── Step 2: Run response utilities based on microstate type ──
    const responseAnalysis = analyzeResponse(cleanedText, microstate);
    logDebug('MICROSTATE:RESPONSE_ANALYSIS', {
        _desc: 'Microstate response analysis — yes/no, ordinal, selection resolution',
        _example: '"2" → { type: ordinal, value: 2 }',
        ...responseAnalysis
    });

    // ── Step 3: Soft sandbox — check for breakthrough BEFORE extraction ──
    if (microstate.sandbox === 'soft') {
        const breakthrough = checkBreakthrough(cleanedText, microstate, storeContext);
        if (breakthrough) {
            logDebug('MICROSTATE:BREAKTHROUGH', {
                _desc: 'Microstate breakthrough — unrelated intent broke through soft sandbox',
                _example: '"show me laptops" during ordinal → clear, fall through',
                ...breakthrough
            });
            console.log(`[MicrostateRunner] 💥 Breakthrough! Intent "${breakthrough.intentName}" broke through the sandbox`);
            await stateManager.clearMicrostate(userId);
            return { handled: false, result: null }; // Let normal pipeline handle
        }
    }

    // ── Step 4: Run entity extraction on the new message ──
    const extractionResult = extractEntities(cleanedText, storeContext, getIdfMap());
    logDebug('MICROSTATE:ENTITY_EXTRACTION', {
        _desc: 'Microstate entity extraction — extract entities from user reply',
        _example: '"Lekki phase 1" → { type: address, value: ... }',
        entities: extractionResult.entities.map(e => ({ type: e.type, value: e.value })),
        residualWords: extractionResult.residualWords
    });

    // ── Step 5: Merge new data ──
    const newParams = buildNewParams(responseAnalysis, extractionResult, microstate);
    const advanced = Object.keys(newParams).length > 0;

    const mergedParams = { ...microstate.params, ...newParams };
    const fulfilled = checkFulfillment(microstate.contract.onFulfilled, mergedParams);

    if (fulfilled) {
        logDebug('MICROSTATE:FULFILLED', {
            _desc: 'Microstate fulfilled — contract params all filled, map to tools',
            _example: 'ordinal_choice "2" → products resolved, add to cart',
            params: mergedParams
        });
        console.log(`[MicrostateRunner] ✅ Microstate fulfilled! Intent: ${microstate.intent}`);

        // Check if there's a chained microstate to spawn (flow chains)
        const nextSpawn = microstate.contract.onFulfilledSpawn;
        await stateManager.clearMicrostate(userId);

        // Normalize params before execution
        const normalizedStatements = parameterNormalizer.normalizeParameters(
            [{ intentName: microstate.intent, parameters: mergedParams }],
            storeContext
        );
        const finalParams = normalizedStatements[0].parameters;

        // Map to tool calls
        const tools = toolMapper.mapToTools([{
            intentName: microstate.intent,
            parameters: finalParams
        }]);

        // If there's a chained spawn, set it up
        if (nextSpawn) {
            await stateManager.setMicrostate(userId, nextSpawn);
        }

        return {
            handled: true,
            result: {
                intents: [{ intentName: microstate.intent, score: microstate.boostScore, parameters: finalParams }],
                tools,
                isMultiIntent: false,
                corrections: { original: userMessage },
                microstate_fulfilled: true
            }
        };
    }

    // ── Not fulfilled yet — advance the microstate ──
    const updated = await stateManager.advanceMicrostate(userId, newParams, advanced);

    // Check if microstate expired after advancing
    if (!updated || updated.contract.messagesUsed >= updated.contract.maxMessages || updated.confidence <= 0) {
        logDebug('MICROSTATE:EXPIRED', {
            _desc: 'Microstate expired — maxMessages or confidence depleted',
            _example: '3 prompts, no valid reply → escalate or fall through',
            reason: !updated ? 'null' : updated.confidence <= 0 ? 'confidence' : 'maxMessages',
            messagesUsed: updated?.contract?.messagesUsed,
            confidence: updated?.confidence
        });
        console.log(`[MicrostateRunner] ⏰ Microstate expired`);

        const escalation = microstate.contract.escalation;
        await stateManager.clearMicrostate(userId);

        if (escalation) {
            const tools = toolMapper.mapToTools([{
                intentName: escalation,
                parameters: mergedParams
            }]);
            return {
                handled: true,
                result: {
                    intents: [{ intentName: escalation, score: 0, parameters: mergedParams }],
                    tools,
                    isMultiIntent: false,
                    corrections: { original: userMessage },
                    microstate_escalated: true
                }
            };
        }

        return { handled: false, result: null };
    }



    // ── Re-prompt the user ──
    const repromptMessage = buildReprompt(microstate, newParams, responseAnalysis);
    logDebug('MICROSTATE:REPROMPT', {
        _desc: 'Microstate reprompt — not fulfilled, ask for more info',
        _example: '"Which address?" when address missing',
        message: repromptMessage
    });

    return {
        handled: true,
        result: {
            intents: [{ intentName: microstate.intent, score: microstate.boostScore, parameters: mergedParams }],
            tools: [{
                tool: 'microstate.disambiguate',
                params: {
                    reason: 'reprompt',
                    message: repromptMessage,
                    parentIntent: microstate.intent,
                    options: microstate.options
                },
                reason: 'Microstate re-prompt'
            }],
            isMultiIntent: false,
            corrections: { original: userMessage },
            microstate_reprompt: true
        }
    };
}


// ═══════════════════════════════════════════════
// Internal Helper Functions
// ═══════════════════════════════════════════════

/**
 * Analyze user response using microstate-appropriate utilities
 */
function analyzeResponse(text, microstate) {
    const analysis = {
        yesNo: resolveYesNo(text),
        ordinal: resolveOrdinal(text),
        selection: null,
        multiSelection: null,
        rawText: text
    };

    // If microstate has options, try selection matching
    if (microstate.options && microstate.options.length > 0) {
        analysis.selection = resolveSelection(text, microstate.options);
        analysis.multiSelection = resolveMultiSelection(text, microstate.options);
    }

    return analysis;
}

/**
 * Build new params from response analysis and entity extraction
 */
function buildNewParams(responseAnalysis, extractionResult, microstate) {
    const newParams = {};
    const onFulfilled = microstate.contract.onFulfilled || [];

    // ── 1. Yes/No confirmation mapping ──
    // If microstate expects 'confirmation' and user said yes/no, map it
    if (onFulfilled.includes('confirmation') && responseAnalysis.yesNo !== 'ambiguous') {
        newParams.confirmation = responseAnalysis.yesNo === 'yes';
    }

    // ── 2. Generic selection mapping for microstates ──
    if (responseAnalysis.selection && onFulfilled.length > 0 && !newParams.attributes) {
        const targetParam = onFulfilled[0]; // Primary param we're waiting for
        newParams[targetParam] = responseAnalysis.selection.match;
    }

    // ── 2b. Ordinal-choice microstate: user said "2" or "first one" → pick that product from list ──
    if (microstate.type === 'ordinal_choice' && responseAnalysis.ordinal != null && microstate.params._ordinal_choice_product_ids) {
        const ids = microstate.params._ordinal_choice_product_ids;
        const oneBased = responseAnalysis.ordinal === -1 ? ids.length : responseAnalysis.ordinal;
        const index = oneBased - 1;
        if (index >= 0 && index < ids.length && onFulfilled.includes('products')) {
            newParams.products = [ids[index]];
            // Clear product_name so toolMapper uses products (resolved ID), not the original phrase (e.g. "seventh one")
            newParams.product_name = null;
        }
    }

    // Map entity types to params
    for (const entity of extractionResult.entities) {
        if (entity.type === 'category' && !newParams.category) {
            newParams.category = entity.value;
        }
        if (entity.type === 'vendor' && !newParams.vendor) {
            newParams.vendor = entity.value;
        }
        if (entity.type === 'brand' && !newParams.brand) {
            newParams.brand = entity.value;
        }
    }

    // Residual words might be the product name we're waiting for
    if (extractionResult.residualWords && extractionResult.residualWords.length > 0) {
        const residualText = extractionResult.residualWords.join(' ').trim();

        // Strip punctuation for junk comparison (so "what?" matches "what")
        const cleaned = residualText.toLowerCase().replace(/[?!.,;:'"]+/g, '').trim();

        // Anti-Junk Filter: don't fulfill on generic questions or fluff
        const junkWords = [
            'what', 'why', 'how', 'when', 'where', 'who', 'which',
            'please', 'just', 'stuff', 'something', 'anything', 'nothing',
            'ok', 'okay', 'yes', 'no', 'yeah', 'nah', 'nope', 'sure',
            'help', 'cancel', 'stop', 'nevermind', 'never mind',
            'thanks', 'thank', 'hello', 'hi', 'hey'
        ];
        const isJunkWord = junkWords.some(kw => cleaned === kw);

        // Question-phrase detection: "what is X", "where is X", "how do I"
        const questionPhrases = [
            'what is', 'what are', 'what was', 'what do', "what's",
            'where is', 'where are', 'where do', "where's",
            'how do', 'how can', 'how is', "how's",
            'when is', 'when do', 'when can',
            'who is', 'who are', "who's",
            'can you', 'do you', 'is there', 'are there',
            'tell me', 'i want to know', 'actually'
        ];
        const isQuestion = questionPhrases.some(qp => cleaned.startsWith(qp));

        // Off-topic terms: clearly not product names
        const offTopicTerms = [
            'address', 'location', 'store', 'shop', 'contact',
            'phone number', 'email', 'website', 'hours', 'opening',
            'delivery', 'shipping', 'return', 'refund', 'policy',
            'payment', 'support', 'complaint'
        ];
        const isOffTopic = offTopicTerms.some(term => cleaned.includes(term));

        const isJunk = isJunkWord || isQuestion || isOffTopic;

        if (isJunk) {
            logDebug('MICROSTATE:JUNK_REJECTED', {
                _desc: 'Microstate junk rejection — filter noise words, question phrases',
                _example: '"please" or "what is" → reject, not a valid product/cart reply',
                residualText,
                cleaned,
                reason: isJunkWord ? 'junk_word' : isQuestion ? 'question_phrase' : 'off_topic_term'
            });
        }

        if (residualText.length >= 2 && !isJunk) {
            // If we're waiting for product_name, residuals are likely it
            if (onFulfilled.includes('product_name') && !newParams.product_name) {
                newParams.product_name = residualText;
            }
            // If we're waiting for products (list), use rawText for splitting
            // (residualWords may lose separators like "and", commas during cleaning/extraction)
            if (onFulfilled.includes('products') && !newParams.products) {
                const splitSource = responseAnalysis.rawText || residualText;
                // Split by: "and", "with", "vs", "versus", "or", "&", ",", "/"
                const splitRegex = /\s+(?:and|with|vs\.?|versus|or)\s+|\s*[&,\/]\s*/i;
                const items = splitSource.split(splitRegex)
                    .map(s => s.trim().toLowerCase())
                    .filter(s => s.length >= 2);

                logDebug('MICROSTATE:PRODUCT_LIST_SPLIT', {
                    _desc: 'Microstate product list split — parse "A and B" or "A, B" into products',
                    _example: '"iphone and samsung" → items: [iphone, samsung]',
                    rawText: splitSource,
                    items,
                    separator: splitSource.match(splitRegex)?.[0]?.trim() || 'none'
                });

                newParams.products = items;
            }
        }
    }

    // ── 3. Quantity detection for microstates expecting 'quantity' ──
    // If the contract is waiting for a quantity and the user sends a bare number,
    // treat it as the quantity (1–100) in a zero‑AI, deterministic way.
    if (onFulfilled.includes('quantity') && newParams.quantity === undefined && responseAnalysis.rawText) {
        const qtyMatch = responseAnalysis.rawText.trim().match(/^(\d{1,3})$/);
        if (qtyMatch) {
            const q = parseInt(qtyMatch[1], 10);
            if (!Number.isNaN(q) && q >= 1 && q <= 100) {
                newParams.quantity = q;
            }
        }
    }

    // ── 4. Apply normalizers & validators (per-microstate) ──
    if (microstate.normalizers || microstate.validators) {
        const norm = microstate.normalizers || {};
        const valids = microstate.validators || {};
        for (const key of Object.keys(newParams)) {
            let value = newParams[key];

            if (typeof norm[key] === 'function') {
                try {
                    value = norm[key](value);
                } catch (e) {
                    console.error('[MicrostateRunner] Normalizer error for', key, e.message);
                }
                newParams[key] = value;
            }

            if (typeof valids[key] === 'function') {
                let ok = true;
                let normalizedValue = value;
                try {
                    const result = valids[key](value);
                    // Support both boolean and object return types
                    if (typeof result === 'object' && result !== null) {
                        ok = result.valid === true;
                        if (result.normalized !== undefined) {
                            normalizedValue = result.normalized;
                        }
                    } else {
                        ok = !!result;
                    }
                } catch (e) {
                    console.error('[MicrostateRunner] Validator error for', key, e.message);
                    ok = false;
                }
                if (!ok) {
                    logDebug('MICROSTATE:VALIDATION_FAILED', {
                        _desc: 'Microstate validation failed — param rejected by validator',
                        _example: 'quantity: 999 → out of range, drop param',
                        param: key,
                        value
                    });
                    delete newParams[key];
                } else {
                    // Update with normalized value if validator returned one
                    newParams[key] = normalizedValue;
                }
            }
        }
    }

    return newParams;
}

/**
 * Check if all required params are fulfilled
 */
function checkFulfillment(onFulfilled, params) {
    if (!onFulfilled || onFulfilled.length === 0) return false;

    return onFulfilled.every(paramName => {
        const val = params[paramName];
        if (val === null || val === undefined) return false;
        if (Array.isArray(val)) return val.length > 0;
        if (typeof val === 'string') return val.trim().length > 0;
        return true;
    });
}

/**
 * Check if a message should break through a soft sandbox.
 * A breakthrough occurs when the user says something completely unrelated
 * to the microstate's intent — e.g., "cancel my order" while in a cart microstate.
 */
function applyBreakthroughConfig(microstate, winnerIntentName, winnerScore) {
    const cfg = microstate.breakthrough || {};
    const minScore = typeof cfg.minScore === 'number' ? cfg.minScore : 1.5;
    const blockIntents = Array.isArray(cfg.blockIntents) ? cfg.blockIntents : [];

    const isDifferentIntent = winnerIntentName !== microstate.intent;
    const isStrongSignal = winnerScore >= minScore;
    const isBlocked = blockIntents.includes(winnerIntentName);

    return { isDifferentIntent, isStrongSignal, isBlocked };
}

function checkBreakthrough(text, microstate, storeContext) {
    // Run schema resolution on the new message
    const extractionResult = extractEntities(text, storeContext, getIdfMap());
    const resolution = resolveIntent(extractionResult, text, getIdfMap(), storeContext);

    if (!resolution.winner) return null;

    // A breakthrough occurs if:
    // 1. Winner is a DIFFERENT intent than the microstate's
    // 2. Winner scores above a threshold (strong signal, not noise)
    const { isDifferentIntent, isStrongSignal, isBlocked } =
        applyBreakthroughConfig(microstate, resolution.winner.intentName, resolution.winner.score);

    // Don't break through for discovery intents (they're often refinement responses)
    const isRelated = ['product_search', 'browse_collection', 'add_to_cart'].includes(resolution.winner.intentName);

    if (isDifferentIntent && isStrongSignal && !isRelated && !isBlocked) {
        return {
            intentName: resolution.winner.intentName,
            score: resolution.winner.score,
            reason: 'Strong unrelated intent detected'
        };
    }

    return null;
}

/**
 * Build a contextual re-prompt message
 */
function buildReprompt(microstate, newParams, responseAnalysis) {
    const hasNewInfo = Object.keys(newParams).length > 0;
    const onFulfilled = microstate.contract.onFulfilled || [];
    const remaining = microstate.contract.maxMessages - microstate.contract.messagesUsed - 1;

    // Determine which param is still pending (first missing)
    const mergedPreview = { ...(microstate.params || {}), ...newParams };
    const pendingParam = onFulfilled.find(p => {
        const val = mergedPreview[p];
        if (val === null || val === undefined) return true;
        if (Array.isArray(val)) return val.length === 0;
        if (typeof val === 'string') return val.trim().length === 0;
        return false;
    }) || onFulfilled[0];

    if (responseAnalysis.yesNo !== 'ambiguous') {
        // User said yes/no but we need something else
        return `I understand, but I still need to know: ${getParamQuestion(pendingParam)}`;
    }

    if (hasNewInfo) {
        return `Got it. I still need: ${getParamQuestion(pendingParam)}`;
    }

    // Generic re-prompt
    if (remaining <= 1) {
        return `I didn't quite get that. Last try — ${getParamQuestion(pendingParam)}`;
    }

    return `Could you specify ${getParamQuestion(pendingParam)}`;
}

/**
 * Convert param name to human-readable question
 */
function getParamQuestion(paramName) {
    const questions = {
        'product_name': 'which product?',
        'products': 'which products?',
        'order_id': 'what\'s the order number?',
        'quantity': 'how many?',
        'vendor': 'from which vendor?',
        'category': 'which category?',
        'address': 'what\'s the delivery address?',
        'payment_method': 'how would you like to pay?',
        'delivery_type': 'which delivery option would you prefer?',
        'confirmation': 'please answer yes or no'
    };
    return questions[paramName] || `what ${paramName}?`;
}


module.exports = {
    run,
    // Internal helpers exposed for targeted tests
    _test: {
        analyzeResponse,
        buildNewParams,
        checkFulfillment,
        checkBreakthrough,
        buildReprompt,
        applyBreakthroughConfig,
        getParamQuestion
    }
};
