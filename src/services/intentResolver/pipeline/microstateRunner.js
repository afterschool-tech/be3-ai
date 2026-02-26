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
const { resolveEngineeredToken, resolveYesNo, resolveOrdinal, resolveSelection, resolveMultiSelection, isTerminationKeyword } = require('../../../utils/responseResolver');
const { logDebug } = require('../../../utils/debugLogger');
const stateManager = require('../../../state/stateManager');
const intentRegistry = require('../config/intentRegistry');
const toolMapper = require('./toolMapper');
const parameterNormalizer = require('./parameterNormalizer');
const stack = require('./stack');
const { cleanText } = require('./nlpCleaner');
const { callBackendAPI } = require('../../../utils/apiClient');
const { processProductList } = require('../../../utils/productUtility');

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

    // Engineered tokens must be resolved from RAW text because cleanText() strips underscores.
    const engineeredToken = resolveEngineeredToken(String(userMessage || '').trim());

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
    // Explicit engineered cancel token is a deterministic termination (no breakthrough).
    if (engineeredToken && engineeredToken.namespace === 'flow' && engineeredToken.command === 'cancel') {
        logDebug('MICROSTATE:TERMINATED', {
            _desc: 'Microstate termination — explicit engineered cancel token',
            _example: '__flow:cancel__ → clear microstate, escalate or fall through',
            reason: 'engineered_token',
            token: engineeredToken.raw
        });
        console.log(`[MicrostateRunner] ❌ Terminated by engineered token: "${engineeredToken.raw}"`);

        const escalation = microstate.contract.escalation;
        await stateManager.clearMicrostate(userId);

        if (escalation) {
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

        return {
            handled: true,
            result: {
                intents: [],
                tools: [],
                isMultiIntent: false,
                corrections: { original: userMessage },
                microstate_cancelled: true
            }
        };
    }

    // Explicit engineered pagination tokens.
    // For product_compare.missing_products, treat "More" as a recommendation cycle (category traversal),
    // otherwise fall back to generic option pagination.
    if (engineeredToken && engineeredToken.namespace === 'nav' && (engineeredToken.command === 'more' || engineeredToken.command === 'prev')) {
        if (microstate && microstate.intent === 'product_compare' && microstate.type === 'missing_products') {
            const next = await advanceCompareRecommendations({
                userId,
                microstate,
                storeContext,
                delta: engineeredToken.command === 'prev' ? -1 : 1
            });

            if (next) {
                return {
                    handled: true,
                    result: {
                        intents: [{ intentName: microstate.intent, score: microstate.boostScore, parameters: next.params }],
                        tools: [{
                            tool: 'microstate.disambiguate',
                            params: {
                                reason: 'compare_recommendations',
                                message: next.message,
                                parentIntent: microstate.intent,
                                options: next.window,
                                baseIndex: 0,
                                controls: { more: next.hasMore, cancel: true, recommendedIndex: 0 },
                                missingParam: 'products'
                            },
                            reason: 'Compare recommendations: next'
                        }],
                        isMultiIntent: false,
                        corrections: { original: userMessage },
                        microstate_reprompt: true,
                        microstate_compare_recommendations: true
                    }
                };
            }
        }

        // Tool-driven pagination microstate: re-run underlying tool with updated paging params.
        if (microstate && microstate.type === 'tool_pagination' && microstate.params && microstate.params.tool) {
            const tool = String(microstate.params.tool);
            const baseParams = (microstate.params.baseParams && typeof microstate.params.baseParams === 'object')
                ? microstate.params.baseParams
                : {};

            const currentPage = Number.isFinite(microstate.params.page) ? Number(microstate.params.page) : 1;
            const delta = engineeredToken.command === 'prev' ? -1 : 1;
            const nextPage = Math.max(1, currentPage + delta);

            const fullState = await stateManager.getState(userId);
            if (fullState && fullState.microstate && fullState.microstate.id === microstate.id) {
                fullState.microstate.params = {
                    ...(fullState.microstate.params || {}),
                    page: nextPage
                };
                await stateManager.setState(userId, fullState);
            }

            return {
                handled: true,
                result: {
                    intents: [{ intentName: microstate.intent, score: microstate.boostScore, parameters: microstate.params }],
                    tools: [{
                        tool,
                        params: {
                            ...baseParams,
                            page: nextPage
                        },
                        reason: 'Tool pagination'
                    }],
                    isMultiIntent: false,
                    corrections: { original: userMessage },
                    microstate_tool_pagination: true
                }
            };
        }

        const allOptions = Array.isArray(microstate.params?._all_options) && microstate.params._all_options.length > 0
            ? microstate.params._all_options
            : (Array.isArray(microstate.options) ? microstate.options : []);

        const pageSize = Number.isFinite(microstate.params?._page_size) ? microstate.params._page_size : 10;
        const currentOffset = Number.isFinite(microstate.params?._page_offset) ? microstate.params._page_offset : 0;

        const delta = engineeredToken.command === 'prev' ? -pageSize : pageSize;
        let nextOffset = currentOffset + delta;
        if (nextOffset < 0) nextOffset = Math.max(0, allOptions.length - (allOptions.length % pageSize || pageSize));
        if (nextOffset >= allOptions.length) nextOffset = 0;

        const nextWindow = allOptions.slice(nextOffset, nextOffset + pageSize);
        const hasMore = allOptions.length > nextOffset + pageSize;

        // Persist updated microstate options + paging params.
        const fullState = await stateManager.getState(userId);
        if (fullState && fullState.microstate && fullState.microstate.id === microstate.id) {
            fullState.microstate.params = {
                ...(fullState.microstate.params || {}),
                _all_options: allOptions,
                _page_size: pageSize,
                _page_offset: nextOffset
            };
            fullState.microstate.options = nextWindow;
            await stateManager.setState(userId, fullState);
        }

        const repromptMessage = buildReprompt({
            ...microstate,
            options: nextWindow,
            params: {
                ...microstate.params,
                _all_options: allOptions,
                _page_size: pageSize,
                _page_offset: nextOffset
            }
        }, {}, { engineeredToken, rawText: cleanedText });

        return {
            handled: true,
            result: {
                intents: [{ intentName: microstate.intent, score: microstate.boostScore, parameters: microstate.params }],
                tools: [{
                    tool: 'microstate.disambiguate',
                    params: {
                        reason: 'reprompt',
                        message: repromptMessage,
                        parentIntent: microstate.intent,
                        options: nextWindow,
                        baseIndex: nextOffset,
                        controls: { more: hasMore, cancel: true, recommendedIndex: 0 }
                    },
                    reason: 'Microstate pagination'
                }],
                isMultiIntent: false,
                corrections: { original: userMessage },
                microstate_reprompt: true
            }
        };
    }

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
    let fulfilled = checkFulfillment(microstate.contract.onFulfilled, mergedParams);

    // Compare UX guard: require at least 2 products before fulfilling product_compare.
    // Prevents generic tokens (e.g., "products") or single-item replies from triggering compare execution.
    if (fulfilled && microstate.intent === 'product_compare') {
        const p = mergedParams.products;
        if (!Array.isArray(p) || p.length < 2) {
            fulfilled = false;
        }
    }

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

        // ── STACK: Check if there's a stack to resume ──
        const stackData = await stateManager.getStack(userId);
        if (stackData && stackData.remaining_intents && stackData.remaining_intents.length > 0) {
            logDebug('MICROSTATE:STACK_PRESERVED', {
                _desc: 'Microstate fulfilled, preserving stack for sequential execution',
                remainingIntents: stackData.remaining_intents.length
            });
            console.log(`[MicrostateRunner] 📚 Preserving stack with ${stackData.remaining_intents.length} remaining intents for sequential execution`);

            // Mark current intent as executed ONLY if not already marked by stack loop
            // The stack loop leaves intent at front of remaining_intents until executed
            const alreadyInExecuted = stackData.executed_intents.some(
                e => e.intentName === microstate.intent
            );
            if (!alreadyInExecuted) {
                stackData.executed_intents.push({ intentName: microstate.intent, parameters: finalParams });
            }

            // Remove the fulfilled intent instance from remaining_intents.
            // IMPORTANT: there may be multiple intents with the same intentName (e.g., vendor_contact twice).
            // We match using the original microstate params (pre-fulfillment) to avoid removing the wrong intent.
            const msParams = microstate?.params || {};
            const msProductName = typeof msParams.product_name === 'string' ? msParams.product_name : null;
            const matchIndex = stackData.remaining_intents.findIndex((ri) => {
                if (!ri || ri.intentName !== microstate.intent) return false;
                const riParams = ri.parameters || {};
                if (msProductName) {
                    return typeof riParams.product_name === 'string' && riParams.product_name === msProductName;
                }
                // Fallback: only remove the first intentName match if we have no stable discriminator.
                return true;
            });

            if (matchIndex >= 0) {
                stackData.remaining_intents.splice(matchIndex, 1);
                console.log(`[MicrostateRunner] 📚 Removed fulfilled intent from remaining queue (index=${matchIndex})`);
            }

            // DO NOT re-resolve ordinals here - search context is not ready yet!
            // Let server.js handle ordinal resolution after each intent executes

            // Update stack but keep it active for server.js to continue
            if (stackData.remaining_intents.length === 0) {
                await stateManager.clearStack(userId);
            } else {
                await stateManager.setStack(userId, stackData);
            }

            // Return only the fulfilled microstate intent
            // Server.js will detect the active stack and continue execution
            return {
                handled: true,
                result: {
                    intents: [{ intentName: microstate.intent, score: microstate.boostScore, parameters: finalParams }],
                    tools,
                    isMultiIntent: false,
                    corrections: { original: userMessage },
                    microstate_fulfilled: true,
                    stack_active: stackData.remaining_intents.length > 0
                }
            };
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
        const expiryReason = !updated ? 'null' : updated.confidence <= 0 ? 'confidence' : 'maxMessages';
        console.log(`[MicrostateRunner] ⏰ Microstate expired | type=${microstate.type} | intent=${microstate.intent} | reason=${expiryReason}`);

        const escalation = microstate.contract.escalation;
        await stateManager.clearMicrostate(userId);

        // If a stack exists, we should NOT kill it on microstate expiry.
        // Expiry is not a "breakthrough" (user starting fresh). It's a termination of the current microstate.
        const stackData = await stateManager.getStack(userId);
        const stackActive = !!(stackData && stackData.remaining_intents && stackData.remaining_intents.length > 0);
        console.log(`[MicrostateRunner] 🧭 Expiry handling | escalation=${escalation ? escalation : 'none'} | stackActive=${stackActive} | remainingIntents=${stackData?.remaining_intents?.length || 0}`);

        if (escalation) {
            console.log(`[MicrostateRunner] 🧭 Expiry action: escalate → ${escalation}`);
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
                    microstate_escalated: true,
                    stack_active: stackActive
                }
            };
        }

        // No escalation: treat as handled so the pipeline doesn't interpret this as a breakthrough.
        // Server/REPL can continue with any preserved stack.
        console.log(`[MicrostateRunner] 🧭 Expiry action: continue stack (no escalation)`);
        return {
            handled: true,
            result: {
                intents: [],
                tools: [],
                isMultiIntent: false,
                corrections: { original: userMessage },
                microstate_expired: true,
                stack_active: stackActive
            }
        };
    }



    // ── Re-prompt the user ──
    const msForReprompt = updated || microstate;
    const repromptMessage = buildReprompt(msForReprompt, newParams, responseAnalysis);
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
                    options: msForReprompt.options,
                    controls: { more: true, cancel: true, recommendedIndex: 0 },
                    missingParam: 'products'
                },
                reason: 'Microstate re-prompt'
            }],
            isMultiIntent: false,
            corrections: { original: userMessage },
            microstate_reprompt: true
        }
    };
}

async function fetchCompareRecommendations({ storeContext, categorySlug, page = 1, limit = 5 }) {
    if (!categorySlug) return null;

    const searchParams = new URLSearchParams({
        category: String(categorySlug),
        per_page: String(limit),
        page: String(page)
    });

    const result = await callBackendAPI(`/search/products?${searchParams.toString()}`);
    if (!result?.success) return null;

    const rawProducts = result?.data?.products || result?.data?.results || [];
    const products = await processProductList(rawProducts);

    const total = Number(result?.data?.pagination?.total || result?.data?.total || 0);
    const hasNext = Number.isFinite(total) && total > 0
        ? (page * limit) < total
        : (Array.isArray(products) && products.length >= limit);

    const options = (products || [])
        .map(p => {
            const id = p?.id || p?.handle || p?.product_id;
            const label = p?.name || p?.title;
            if (!id || !label) return null;
            return { label: String(label), value: String(id), price: p?.price || p?.price_display || undefined };
        })
        .filter(Boolean);

    return { options, hasNext, products };
}

function pickRandomActiveCategorySlug(storeContext) {
    const cats = Object.values(storeContext?.CATEGORIES || {});
    const active = cats.filter(c => (c?.total_count || 0) > 0 && c?.slug);
    if (active.length === 0) return null;
    return active[Math.floor(Math.random() * active.length)].slug;
}

function getSiblingCategorySlugs(storeContext, categoryId) {
    if (!storeContext?.CATEGORIES || !categoryId) return [];
    const catEntry = Object.values(storeContext.CATEGORIES).find(c => c?.id === categoryId);
    if (!catEntry?.parent_id) return [];
    return Object.values(storeContext.CATEGORIES)
        .filter(c => c?.parent_id === catEntry.parent_id && c?.id !== categoryId && c?.slug)
        .map(c => c.slug);
}

function findCategorySlugById(storeContext, categoryId) {
    if (!storeContext?.CATEGORIES || !categoryId) return null;
    const cat = Object.values(storeContext.CATEGORIES).find(c => c?.id === categoryId);
    return cat?.slug || null;
}

async function advanceCompareRecommendations({ userId, microstate, storeContext, delta = 1 }) {
    const ms = microstate || {};
    const params = (ms.params && typeof ms.params === 'object') ? { ...ms.params } : {};

    const currentProducts = Array.isArray(params.products) ? params.products : [];
    const hasFirstProduct = currentProducts.length >= 1;
    const firstProduct = hasFirstProduct ? currentProducts[0] : null;

    // Keep recommendation state in microstate params.
    const rec = (params._compare_rec && typeof params._compare_rec === 'object') ? { ...params._compare_rec } : {};
    const limit = 5;

    // Phase A: no products picked yet → random categories rotation
    if (!hasFirstProduct) {
        const seed = Array.isArray(rec.seedCategories) ? rec.seedCategories : [];
        const idx = Number.isFinite(rec.seedIndex) ? rec.seedIndex : 0;

        let seedCategories = seed;
        if (seedCategories.length === 0) {
            const cats = Object.values(storeContext?.CATEGORIES || {})
                .filter(c => (c?.total_count || 0) > 0 && c?.slug)
                .map(c => c.slug);
            // Small random sample to rotate through.
            seedCategories = cats.sort(() => Math.random() - 0.5).slice(0, 6);
        }

        const nextIndex = seedCategories.length > 0
            ? (idx + (delta >= 0 ? 1 : -1) + seedCategories.length) % seedCategories.length
            : 0;

        const categorySlug = seedCategories[nextIndex] || pickRandomActiveCategorySlug(storeContext);
        if (!categorySlug) return null;

        const page = 1;
        const fetched = await fetchCompareRecommendations({ storeContext, categorySlug, page, limit });
        if (!fetched || !Array.isArray(fetched.options) || fetched.options.length === 0) return null;

        rec.phase = 'seed';
        rec.seedCategories = seedCategories;
        rec.seedIndex = nextIndex;
        rec.categorySlug = categorySlug;
        rec.page = page;

        params._compare_rec = rec;

        // Persist options directly on microstate so ordinal selection works.
        const fullState = await stateManager.getState(userId);
        if (fullState?.microstate && fullState.microstate.id === ms.id) {
            fullState.microstate.params = { ...(fullState.microstate.params || {}), _compare_rec: rec };
            fullState.microstate.options = fetched.options;
            await stateManager.setState(userId, fullState);
        }

        return {
            message: `Here are some suggestions from **${categorySlug}**. You can also type any product name to compare:`,
            window: fetched.options,
            hasMore: fetched.hasNext || seedCategories.length > 1,
            params
        };
    }

    // Phase B: first product picked → recommend from its category then siblings.
    if (!rec.phase || rec.phase === 'seed') {
        rec.phase = 'by_category';
        rec.baseCategoryId = rec.baseCategoryId || null;
        rec.baseCategorySlug = rec.baseCategorySlug || null;
        rec.siblingSlugs = Array.isArray(rec.siblingSlugs) ? rec.siblingSlugs : [];
        rec.siblingIndex = Number.isFinite(rec.siblingIndex) ? rec.siblingIndex : 0;
        rec.page = Number.isFinite(rec.page) ? rec.page : 1;
    }

    // Determine base category from first product if needed.
    if (!rec.baseCategoryId && firstProduct) {
        try {
            const details = await callBackendAPI(`/products/storefront/products/${firstProduct}`);
            const catIds = details?.data?.product?.metadata?.category_ids || [];
            if (Array.isArray(catIds) && catIds.length > 0) {
                rec.baseCategoryId = catIds[0];
            }
        } catch (_) {}
    }

    if (!rec.baseCategorySlug && rec.baseCategoryId) {
        rec.baseCategorySlug = findCategorySlugById(storeContext, rec.baseCategoryId);
    }

    if (rec.siblingSlugs.length === 0 && rec.baseCategoryId) {
        rec.siblingSlugs = getSiblingCategorySlugs(storeContext, rec.baseCategoryId);
        rec.siblingIndex = 0;
    }

    const traversal = [rec.baseCategorySlug, ...(rec.siblingSlugs || [])].filter(Boolean);
    if (traversal.length === 0) return null;

    // Paging within current category first; if no next page, move to next category.
    let currentCatIndex = Number.isFinite(rec.siblingIndex) ? rec.siblingIndex : 0;
    let currentCatSlug = traversal[Math.min(currentCatIndex, traversal.length - 1)];
    let page = Number.isFinite(rec.page) ? rec.page : 1;

    if (delta >= 0) {
        // Try next page; if exhausted, advance category.
        const probe = await fetchCompareRecommendations({ storeContext, categorySlug: currentCatSlug, page, limit });
        if (probe && probe.hasNext) {
            page = page + 1;
        } else {
            currentCatIndex = (currentCatIndex + 1) % traversal.length;
            currentCatSlug = traversal[currentCatIndex];
            page = 1;
        }
    } else {
        // Prev page; if at start, go to previous category.
        if (page > 1) {
            page = Math.max(1, page - 1);
        } else {
            currentCatIndex = (currentCatIndex - 1 + traversal.length) % traversal.length;
            currentCatSlug = traversal[currentCatIndex];
            page = 1;
        }
    }

    const fetched = await fetchCompareRecommendations({ storeContext, categorySlug: currentCatSlug, page, limit });
    if (!fetched || !Array.isArray(fetched.options) || fetched.options.length === 0) {
        return null;
    }

    rec.siblingIndex = currentCatIndex;
    rec.categorySlug = currentCatSlug;
    rec.page = page;
    params._compare_rec = rec;

    const fullState = await stateManager.getState(userId);
    if (fullState?.microstate && fullState.microstate.id === ms.id) {
        fullState.microstate.params = { ...(fullState.microstate.params || {}), _compare_rec: rec };
        fullState.microstate.options = fetched.options;
        await stateManager.setState(userId, fullState);
    }

    const firstLabel = String(firstProduct || '').trim();
    return {
        message: `Pick the second product to compare with **${firstLabel}** (recommended from **${currentCatSlug}**):`,
        window: fetched.options,
        hasMore: fetched.hasNext || traversal.length > 1,
        params
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
        engineeredToken: resolveEngineeredToken(text),
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

        // Special-case: product_compare collects a LIST; option picks should append to products.
        if (microstate.intent === 'product_compare' && targetParam === 'products') {
            const picked = responseAnalysis.selection.match;
            const existing = Array.isArray(microstate?.params?.products) ? microstate.params.products : [];
            const combined = [...existing, picked];
            const deduped = [];
            const seen = new Set();
            for (const x of combined) {
                const key = (x ?? '').toString().trim();
                if (!key) continue;
                const k = key.toLowerCase();
                if (seen.has(k)) continue;
                seen.add(k);
                deduped.push(key);
            }
            newParams.products = deduped;
            newParams.product_name = null;

            const idx = Number.isFinite(responseAnalysis.selection.index) ? responseAnalysis.selection.index : null;
            const opt = (idx != null && Array.isArray(microstate.options)) ? microstate.options[idx] : null;
            const label = opt && typeof opt === 'object' ? opt.label : null;
            const key = (picked ?? '').toString().trim();
            if (label && key) {
                const prev = (microstate?.params?._compare_labels && typeof microstate.params._compare_labels === 'object')
                    ? microstate.params._compare_labels
                    : {};
                newParams._compare_labels = { ...prev, [key]: String(label) };
            }
        } else {
            newParams[targetParam] = responseAnalysis.selection.match;
        }
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

                // IMPORTANT: If the microstate was seeded with existing products (e.g. compare button
                // __product:compare:<id>__ sets products: [firstProductId]), do NOT overwrite.
                // Append the newly collected product(s) and dedupe.
                const existing = Array.isArray(microstate?.params?.products) ? microstate.params.products : [];
                const combined = [...existing, ...items];
                const deduped = [];
                const seen = new Set();
                for (const x of combined) {
                    const key = (x ?? '').toString().trim();
                    if (!key) continue;
                    const k = key.toLowerCase();
                    if (seen.has(k)) continue;
                    seen.add(k);
                    deduped.push(key);
                }

                newParams.products = deduped;
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

    // Special UX: product_compare should ask for the second product once the first is captured.
    // Avoids confusing generic prompts like "which products?" after the user already gave one.
    if (microstate.intent === 'product_compare') {
        const products = mergedPreview.products;
        if (Array.isArray(products) && products.length === 1) {
            const first = String(products[0] || '').trim();
            if (first) {
                const labelMap = (mergedPreview._compare_labels && typeof mergedPreview._compare_labels === 'object')
                    ? mergedPreview._compare_labels
                    : null;
                const display = labelMap && labelMap[first] ? String(labelMap[first]) : first;
                return `Got it — you want to compare **${display}**. What’s the second product? (You can type any product name.)`;
            }
            return `Got it. What’s the second product you want to compare? (You can type any product name.)`;
        }
    }
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
