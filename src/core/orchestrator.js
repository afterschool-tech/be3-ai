/**
 * Tool Orchestrator
 * Executes sequences of tools selected by the AI.
 * Manages context passing, error handling, and results aggregation.
 */

const { TOOL_REGISTRY } = require('../tools/registry');
const { getContextSummary, CATEGORIES, VENDORS, ATTRIBUTES, COLLECTIONS } = require('../context/storeContext');
const { logDebug } = require('../utils/debugLogger');
const stateManager = require('../state/stateManager');

// Phase 1: Same-turn multi-intent — skip cart.add when product_id is unresolved pronoun
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SKIPPED_ADD_MESSAGE = "I found some options. Say 'add the first one' or 'add the white one' in your next message to add it to cart.";

function isUnresolvedPronounForAdd(value) {
    if (value == null || typeof value !== 'string') return false;
    const v = value.trim();
    if (UUID_REGEX.test(v)) return false; // resolved to UUID
    const lower = v.toLowerCase();
    // Literal "one"/"ones" or phrase ending with " one"/" ones" (e.g. "first one", "white one", "the flagship one")
    return lower === 'one' || lower === 'ones' ||
        /\s+(one|ones)$/.test(lower) || /^(one|ones)$/.test(lower);
}

/**
 * Execute a list of selected tools
 * @param {Array} toolsSelected - Array of { tool, params, reason }
 * @param {string} sessionId - Current user session ID
 * @returns {Promise<Array>} Array of execution results
 */
async function executeTools(toolsSelected, sessionId) {
    let microstate = null;
    try {
        microstate = sessionId ? await stateManager.getMicrostate(sessionId) : null;
    } catch (_) { }

    const context = {
        CATEGORIES,
        VENDORS,
        ATTRIBUTES,
        COLLECTIONS,
        summary: getContextSummary(),
        sessionId: sessionId,
        microstate_active: !!microstate,
        microstate_scope: microstate ? 'microstate' : 'global'
    };

    const results = [];
    const isMultiTool = toolsSelected.length > 1;

    logDebug('ORCHESTRATOR:START', {
        _desc: 'Orchestrator start — begin tool execution loop',
        _example: 'cart.add + product.search → execute in order, aggregate results',
        sessionId,
        toolCount: toolsSelected.length,
        tools: toolsSelected.map(t => ({ tool: t.tool, params: t.params, reason: t.reason }))
    });

    for (const toolCall of toolsSelected) {
        const toolName = toolCall.tool;
        logDebug(`ORCHESTRATOR:TOOL_LOOKUP [${toolName}]`, {
            _desc: 'Tool lookup — find tool implementation in TOOL_REGISTRY',
            _example: '"cart.add" → lookup handler function',
            toolName
        });
        const toolDef = TOOL_REGISTRY[toolName];

        if (!toolDef) {
            logDebug('ORCHESTRATOR:TOOL_NOT_FOUND', {
                _desc: 'Tool lookup — tool name not in TOOL_REGISTRY',
                _example: '"cart.add" missing → error, skip',
                toolName
            });
            results.push({
                tool: toolName,
                error: `Tool ${toolName} not found`,
                success: false
            });
            continue;
        }

        // Phase 1 guard: skip cart.add when product_id is "one"/"ones" in same-turn multi-intent
        if (toolName === 'cart.add' && isMultiTool) {
            const productId = toolCall.params && toolCall.params.product_id;
            if (isUnresolvedPronounForAdd(productId)) {
                logDebug('ORCHESTRATOR:SKIP_UNRESOLVED_PRONOUN', {
                    _desc: 'Skip cart.add when product_id is "one"/"ones" in same-turn multi-intent',
                    _example: 'product_search + add "one" same turn → skip add, suggest "add first one"',
                    tool: toolName,
                    product_id: productId,
                    reason: 'same-turn multi-intent; context not yet populated'
                });
                results.push({
                    tool: toolName,
                    params: toolCall.params,
                    result: null,
                    success: false,
                    reason: toolCall.reason,
                    skipped: true,
                    skippedReason: 'unresolved_pronoun_same_turn',
                    skippedMessage: SKIPPED_ADD_MESSAGE
                });
                continue;
            }
        }

        logDebug(`ORCHESTRATOR:CONTEXT_PASSING [${toolName}]`, {
            _desc: 'Context passing — build context object (categories, vendors, attributes, sessionId)',
            _example: 'Pass CATEGORIES, ATTRIBUTES, sessionId to product.search',
            toolName,
            hasCategories: !!context.CATEGORIES,
            hasVendors: !!context.VENDORS,
            hasAttributes: !!context.ATTRIBUTES,
            sessionId: context.sessionId
        });

        logDebug(`ORCHESTRATOR:EXECUTING [${toolName}]`, {
            _desc: 'Tool handler invocation — call toolDef.handler with params and context',
            _example: 'cart.add({ product_id, quantity }) → handler runs',
            params: toolCall.params,
            reason: toolCall.reason
        });

        try {
            // Merge pipeline context (engineered flags) into the tool execution context
            if (toolCall.pipelineContext) {
                Object.assign(context, toolCall.pipelineContext);
            }

            // CONVERSATION QUERY INJECTION:
            // statementText is the raw user utterance for this specific intent.
            // The NLU may not always extract it as 'query' (it uses 'product_name' as catch-all).
            // For rag.query (and backward-compat conversation.chat) we ensure query is always
            // populated from statementText.
            const finalParams = { ...toolCall.params };
            const isRagTool = toolName === 'rag.query' || toolName === 'conversation.chat';
            if (isRagTool && !finalParams.query && toolCall.statementText) {
                finalParams.query = toolCall.statementText;
            }

            const result = await toolDef.handler(finalParams, context, results);

            const executionResult = {
                tool: toolName,
                params: toolCall.params,
                result: result,
                success: result && !result.error,
                reason: toolCall.reason,
                ported: !!toolCall.portedFrom,
                portedFrom: toolCall.portedFrom || undefined,
                statementText: toolCall.statementText || (toolCall.pipelineContext && toolCall.pipelineContext.statementText) || undefined
            };

            // Debug: log ported tools
            if (executionResult.ported) {
                console.log(`[Orchestrator] ✅ Tool ${toolName} is ported from ${executionResult.portedFrom}`);
            }

            results.push(executionResult);

            logDebug(`ORCHESTRATOR:RESULT [${toolName}]`, {
                _desc: 'Tool result — accumulate in results array',
                _example: 'cart.add success → { success: true, message }',
                success: executionResult.success,
                error: result.error || null,
                productCount: result.products?.length || result.results?.length || null,
                message: result.message || null
            });

            const isCritical = toolName.startsWith('cart.') || toolName.startsWith('order.');
            if (result.error && isCritical) {
                logDebug('ORCHESTRATOR:CIRCUIT_BREAKER', {
                    _desc: 'Circuit breaker — stop on error for cart/order tools',
                    _example: 'cart.add fails → break, do not run remaining tools',
                    toolName,
                    error: result.error
                });
                break;
            } else if (result.error) {
                logDebug('ORCHESTRATOR:NON_CRITICAL_FAIL', {
                    _desc: 'Non-critical tool failure — log but continue',
                    _example: 'product.search empty → log, continue to next tool',
                    toolName,
                    error: result.error
                });
            }

        } catch (error) {
            logDebug(`ORCHESTRATOR:EXCEPTION [${toolName}]`, {
                _desc: 'Tool threw exception — push error result, break',
                _example: 'TypeError: query.toLowerCase → exception logged, stop',
                error: error.message,
                stack: error.stack?.split('\n').slice(0, 3)
            });
            results.push({
                tool: toolName,
                error: error.message,
                success: false
            });
            break;
        }
    }

    logDebug('ORCHESTRATOR:COMPLETE', {
        _desc: 'Orchestrator complete — all tools run, results aggregated',
        _example: '2 tools → 2 results, 1 success 1 failure',
        sessionId,
        totalResults: results.length,
        successes: results.filter(r => r.success).length,
        failures: results.filter(r => !r.success).length
    });

    return results;
}

module.exports = { executeTools };
