/**
 * Tool Orchestrator
 * Executes sequences of tools selected by the AI.
 * Manages context passing, error handling, and results aggregation.
 */

const { TOOL_REGISTRY } = require('../tools/registry');
const { getContextSummary, CATEGORIES, VENDORS, ATTRIBUTES, COLLECTIONS } = require('../context/storeContext');
const { logDebug } = require('../utils/debugLogger');

/**
 * Execute a list of selected tools
 * @param {Array} toolsSelected - Array of { tool, params, reason }
 * @param {string} sessionId - Current user session ID
 * @returns {Promise<Array>} Array of execution results
 */
async function executeTools(toolsSelected, sessionId) {
    const context = {
        CATEGORIES,
        VENDORS,
        ATTRIBUTES,
        COLLECTIONS,
        summary: getContextSummary(),
        sessionId: sessionId
    };

    const results = [];

    logDebug('ORCHESTRATOR:START', {
        sessionId,
        toolCount: toolsSelected.length,
        tools: toolsSelected.map(t => ({ tool: t.tool, params: t.params, reason: t.reason }))
    });

    for (const toolCall of toolsSelected) {
        const toolName = toolCall.tool;
        const toolDef = TOOL_REGISTRY[toolName];

        if (!toolDef) {
            logDebug('ORCHESTRATOR:TOOL_NOT_FOUND', { toolName });
            results.push({
                tool: toolName,
                error: `Tool ${toolName} not found`,
                success: false
            });
            continue;
        }

        logDebug(`ORCHESTRATOR:EXECUTING [${toolName}]`, {
            params: toolCall.params,
            reason: toolCall.reason
        });

        try {
            const result = await toolDef.handler(toolCall.params, context, results);

            const executionResult = {
                tool: toolName,
                params: toolCall.params,
                result: result,
                success: result && !result.error,
                reason: toolCall.reason
            };

            results.push(executionResult);

            logDebug(`ORCHESTRATOR:RESULT [${toolName}]`, {
                success: executionResult.success,
                error: result.error || null,
                productCount: result.products?.length || result.results?.length || null,
                message: result.message || null
            });

            const isCritical = toolName.startsWith('cart.') || toolName.startsWith('order.');
            if (result.error && isCritical) {
                logDebug('ORCHESTRATOR:CIRCUIT_BREAKER', { toolName, error: result.error });
                break;
            } else if (result.error) {
                logDebug('ORCHESTRATOR:NON_CRITICAL_FAIL', { toolName, error: result.error });
            }

        } catch (error) {
            logDebug(`ORCHESTRATOR:EXCEPTION [${toolName}]`, {
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
        sessionId,
        totalResults: results.length,
        successes: results.filter(r => r.success).length,
        failures: results.filter(r => !r.success).length
    });

    return results;
}

module.exports = { executeTools };
