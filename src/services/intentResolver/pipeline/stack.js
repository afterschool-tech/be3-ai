/**
 * STACK (Statement/Intent Stack) System
 * 
 * Manages sequential intent execution:
 * - Executes intents one at a time
 * - Preserves remaining intents when microstate opens
 * - Re-resolves ordinals after each intent completes
 * - Resumes next intent after microstate fulfillment
 */

const stateManager = require('../../../state/stateManager');
const toolMapper = require('./toolMapper');
const parameterNormalizer = require('./parameterNormalizer');
const { logDebug } = require('../../../utils/debugLogger');
const { resolveGroupedOrdinal, resolveOrdinal } = require('../../../utils/responseResolver');

const STACK_TTL_SECONDS = 300; // 5 minutes, same as microstate

/**
 * Execute intents sequentially, one at a time.
 * Returns microstate_opened flag if a microstate opens during execution.
 */
async function executeIntentStack(intents, state, storeContext, sessionId) {
    const userId = state.user_id;
    
    if (!intents || intents.length === 0) {
        return { intents, tools: [], isMultiIntent: false };
    }

    // Single intent - execute normally without stack overhead
    if (intents.length === 1) {
        const tools = toolMapper.mapToTools([{
            intentName: intents[0].intentName,
            parameters: intents[0].parameters || {},
            _ported_from: intents[0]._ported_from,
            statementText: intents[0].statementText
        }]);
        return { intents, tools, isMultiIntent: false };
    }

    logDebug('STACK:EXECUTE', {
        _desc: 'STACK execute — multiple intents, will execute sequentially',
        _example: '"search phones and add first two" → Intent 1 then Intent 2',
        intentCount: intents.length,
        intents: intents.map(i => i.intentName)
    });

    // Initialize stack state
    const stack = {
        remaining_intents: intents.slice(1), // All but first
        current_intent_index: 0,
        executed_intents: [],
        accumulated_results: [],
        // Stack-scoped search context (so ordinals resolve against the latest search in THIS stack)
        last_search_context: null,
        search_history: [],
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + STACK_TTL_SECONDS * 1000).toISOString()
    };

    await stateManager.setStack(userId, stack);

    // Execute first intent
    const firstIntent = intents[0];
    const tools = toolMapper.mapToTools([{
        intentName: firstIntent.intentName,
        parameters: firstIntent.parameters || {},
        _ported_from: firstIntent._ported_from,
        statementText: firstIntent.statementText
    }]);

    logDebug('STACK:EXECUTE_FIRST', {
        _desc: 'STACK executing first intent',
        intent: firstIntent.intentName,
        remainingCount: stack.remaining_intents.length
    });

    return {
        intents,
        tools,
        isMultiIntent: true,
        stack_active: true,
        current_intent_index: 0,
        total_intents: intents.length
    };
}

/**
 * Resume stack after microstate fulfillment.
 * Executes the next intent in the queue.
 */
async function resumeIntentStack(userId, state, storeContext) {
    const stack = await stateManager.getStack(userId);
    
    if (!stack) {
        logDebug('STACK:RESUME_NO_STACK', {
            _desc: 'No stack to resume',
            userId
        });
        return null;
    }

    // Check expiration
    if (stack.expires_at && new Date() > new Date(stack.expires_at)) {
        logDebug('STACK:EXPIRED', {
            _desc: 'Stack expired, clearing',
            userId
        });
        await stateManager.clearStack(userId);
        return null;
    }

    // Mark current intent as complete, move to next
    const currentIntent = stack.remaining_intents[0];
    if (currentIntent) {
        stack.executed_intents.push(currentIntent);
        stack.remaining_intents = stack.remaining_intents.slice(1);
        stack.current_intent_index++;
    }

    // Check if more intents remain
    if (stack.remaining_intents.length === 0) {
        logDebug('STACK:COMPLETE', {
            _desc: 'All intents executed, clearing stack',
            executedCount: stack.executed_intents.length
        });
        await stateManager.clearStack(userId);
        return { complete: true };
    }

    // Re-resolve ordinals for remaining intents using updated reference_map
    await reResolveOrdinalsForRemainingIntents(stack.remaining_intents, state, storeContext);

    // Execute next intent
    const nextIntent = stack.remaining_intents[0];
    const tools = toolMapper.mapToTools([{
        intentName: nextIntent.intentName,
        parameters: nextIntent.parameters || {},
        _ported_from: nextIntent._ported_from,
        statementText: nextIntent.statementText
    }]);

    // Update stack
    await stateManager.setStack(userId, stack);

    logDebug('STACK:RESUME_NEXT', {
        _desc: 'STACK resuming next intent',
        intent: nextIntent.intentName,
        remainingCount: stack.remaining_intents.length,
        executedCount: stack.executed_intents.length
    });

    return {
        intents: [nextIntent],
        tools,
        isMultiIntent: false,
        stack_active: true,
        current_intent_index: stack.current_intent_index,
        total_intents: stack.executed_intents.length + stack.remaining_intents.length + 1,
        resumed_from_stack: true
    };
}

/**
 * Re-resolve ordinals for remaining intents using updated search_context.
 * This fixes the "first two" problem where ordinals can't resolve on first pass.
 */
async function reResolveOrdinalsForRemainingIntents(remainingIntents, state, storeContext) {
    const userId = state.user_id;
    // Prefer stack-scoped context (latest search executed within this stack),
    // and fall back to global search_context for non-stacked interactions.
    const stackData = await stateManager.getStack(userId);
    const stackSearchCtx = stackData?.last_search_context || null;
    const searchCtx = (stackSearchCtx && Array.isArray(stackSearchCtx.product_ids) && stackSearchCtx.product_ids.length > 0)
        ? stackSearchCtx
        : await stateManager.getSearchContext(userId);
    
    console.log(`[ORDINAL DEBUG] 🔍 userId: ${userId} | searchCtx: ${searchCtx ? '✓' : '✗'} | productIds: ${searchCtx?.product_ids?.length || 0} | source: ${searchCtx === stackSearchCtx ? 'stack' : 'global'}`);
    
    if (!searchCtx || !searchCtx.product_ids || searchCtx.product_ids.length === 0) {
        console.log(`[ORDINAL DEBUG] ⚠️  No search context - skipping ordinal resolution`);
        return;
    }

    logDebug('STACK:RERESOLVE_ORDINALS', {
        _desc: 'Re-resolving ordinals for remaining intents',
        intentCount: remainingIntents.length,
        productCount: searchCtx.product_ids.length
    });

    for (const intent of remainingIntents) {
        const params = intent.parameters || {};
        
        // Skip intents that don't need ordinal resolution
        if (!['add_to_cart', 'product_compare', 'check_availability', 'remove_from_cart'].includes(intent.intentName)) {
            continue;
        }

        const productsParam = params.products;
        const productNameParam = params.product_name;
        const originalGroupedOrdinal = params._context_grouped_ordinal;
        const originalSingleOrdinal = params._context_single_ordinal;
        const isUuid = (v) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

        let phraseStr = null;
        let phraseSource = null;

        // Extract ordinal phrase from products or product_name.
        // IMPORTANT: products[0] may already be a UUID from an earlier re-resolve against a smaller search_context.
        // In that case, if we have the original ordinal stored, prefer it so we can re-resolve against the latest context.
        if (Array.isArray(productsParam) && productsParam.length === 1 && typeof productsParam[0] === 'string') {
            const candidate = productsParam[0];
            const hasStoredOrdinal = typeof originalGroupedOrdinal === 'string' || typeof originalSingleOrdinal === 'string';
            const storedOrdinal = typeof originalGroupedOrdinal === 'string' ? originalGroupedOrdinal : (typeof originalSingleOrdinal === 'string' ? originalSingleOrdinal : null);

            // If candidate is UUID and we have a stored ordinal, and the current context is larger than what we resolved before,
            // re-attempt using the stored ordinal.
            if (isUuid(candidate) && hasStoredOrdinal && Array.isArray(searchCtx?.product_ids) && searchCtx.product_ids.length > (Array.isArray(productsParam) ? productsParam.length : 0)) {
                phraseStr = storedOrdinal;
                phraseSource = originalGroupedOrdinal ? '_context_grouped_ordinal' : '_context_single_ordinal';
                console.log(`[ORDINAL DEBUG] 🔁 Re-attempting ordinal using stored phrase (${phraseSource}) because products[0] is UUID and searchCtx expanded`);
            } else {
                phraseStr = candidate;
                phraseSource = 'products[0]';
            }
        } else if (productNameParam && typeof productNameParam === 'string') {
            phraseStr = productNameParam;
            phraseSource = 'product_name';
        } else if (typeof originalGroupedOrdinal === 'string') {
            phraseStr = originalGroupedOrdinal;
            phraseSource = '_context_grouped_ordinal';
        } else if (typeof originalSingleOrdinal === 'string') {
            phraseStr = originalSingleOrdinal;
            phraseSource = '_context_single_ordinal';
        }

        if (!phraseStr) continue;

        // Before snapshot (so we can see what we are about to mutate)
        const beforeSnapshot = {
            products: params.products,
            product_name: params.product_name,
            _from_context: params._from_context,
            _context_product_ids: params._context_product_ids
        };

        // Always log the exact ordinal candidate we are attempting to resolve
        console.log(`[ORDINAL DEBUG] 🎯 Intent: ${intent.intentName} | raw: "${phraseStr}" | sourceField: ${phraseSource} | before: ${JSON.stringify(beforeSnapshot)}`);

        // Try grouped ordinal: "first two", "top three", "last four"
        const groupedIndices = resolveGroupedOrdinal(phraseStr, searchCtx.product_ids.length);
        console.log(`[ORDINAL DEBUG] 📊 groupedIndices: ${JSON.stringify(groupedIndices)}`);
        
        if (groupedIndices && groupedIndices.length > 0) {
            const resolvedIds = groupedIndices.map(i => searchCtx.product_ids[i]);
            params.products = resolvedIds;
            // Prevent toolMapper from overriding resolved IDs with stale product_name
            // (toolMapper has a single-item expansion preference that can select product_name).
            delete params.product_name;
            params._context_product_ids = resolvedIds;
            params._context_grouped_ordinal = phraseStr;
            params._from_context = true;
            params._context_source = searchCtx.source_intent;
            params._context_query = searchCtx.query || '';
            
            console.log(`[ORDINAL DEBUG] ✅ RESOLVED "${phraseStr}" → ${resolvedIds.length} products`);
            console.log(`[ORDINAL DEBUG] 🧾 After: ${JSON.stringify({ products: params.products, product_name: params.product_name, _from_context: params._from_context, _context_product_ids: params._context_product_ids })}`);
            
            logDebug('STACK:RERESOLVED_GROUPED', {
                _desc: 'Re-resolved grouped ordinal',
                intent: intent.intentName,
                phrase: phraseStr,
                resolvedCount: resolvedIds.length
            });
            continue;
        }

        // Try single ordinal: "first one", "second one", "last one"
        if (/(?:one|ones)$/i.test(phraseStr)) {
            const ordPhrase = phraseStr.replace(/\s+(one|ones)$/i, '').trim();
            const oneBased = resolveOrdinal(ordPhrase);
            const listLen = searchCtx.product_ids.length;
            
            if (oneBased != null && oneBased >= 1 && oneBased <= listLen) {
                const index = oneBased - 1;
                const resolvedIds = [searchCtx.product_ids[index]];
                params.products = resolvedIds;
                // Prevent toolMapper from overriding resolved IDs with stale product_name
                delete params.product_name;
                params._context_product_ids = resolvedIds;
                params._context_single_ordinal = phraseStr;
                params._from_context = true;
                params._context_source = searchCtx.source_intent;
                params._context_query = searchCtx.query || '';
                
                logDebug('STACK:RERESOLVED_SINGLE', {
                    _desc: 'Re-resolved single ordinal',
                    intent: intent.intentName,
                    phrase: phraseStr,
                    oneBased,
                    resolvedId: resolvedIds[0]
                });
                console.log(`[ORDINAL DEBUG] 🧾 After: ${JSON.stringify({ products: params.products, product_name: params.product_name, _from_context: params._from_context, _context_product_ids: params._context_product_ids })}`);
            } else if (oneBased === -1 && listLen > 0) {
                // "last one"
                const resolvedIds = [searchCtx.product_ids[listLen - 1]];
                params.products = resolvedIds;
                // Prevent toolMapper from overriding resolved IDs with stale product_name
                delete params.product_name;
                params._context_product_ids = resolvedIds;
                params._context_single_ordinal = 'last';
                params._from_context = true;
                params._context_source = searchCtx.source_intent;
                params._context_query = searchCtx.query || '';
                
                logDebug('STACK:RERESOLVED_LAST', {
                    _desc: 'Re-resolved last ordinal',
                    intent: intent.intentName,
                    resolvedId: resolvedIds[0]
                });
                console.log(`[ORDINAL DEBUG] 🧾 After: ${JSON.stringify({ products: params.products, product_name: params.product_name, _from_context: params._from_context, _context_product_ids: params._context_product_ids })}`);
            }
        }
    }
}

/**
 * Check if there's an active stack for the user.
 */
async function hasActiveStack(userId) {
    const stack = await stateManager.getStack(userId);
    if (!stack) return false;
    
    // Check expiration
    if (stack.expires_at && new Date() > new Date(stack.expires_at)) {
        await stateManager.clearStack(userId);
        return false;
    }
    
    return true;
}

/**
 * Clear the stack (e.g., on cancellation).
 */
async function clearStack(userId) {
    await stateManager.clearStack(userId);
}

module.exports = {
    executeIntentStack,
    resumeIntentStack,
    reResolveOrdinalsForRemainingIntents,
    hasActiveStack,
    clearStack
};
