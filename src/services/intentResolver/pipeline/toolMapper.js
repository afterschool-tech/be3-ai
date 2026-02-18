/**
 * Pipeline Stage 8: Tool Mapper
 * Maps resolved intents to tool calls compatible with the existing orchestrator.
 * 
 * Imports: intentRegistry from config
 * Inline data: NONE
 */

const intentRegistry = require('../config/intentRegistry');

/**
 * Map a resolved intent to a tool call object (or multiple objects if expansion is used).
 * Translates intent parameter names to tool parameter names using paramMap.
 * 
 * @param {Object} resolvedIntent - { intentName, score, parameters }
 * @returns {Array} - Array of { tool, params, reason }
 */
function mapToTool(resolvedIntent) {
    const intent = intentRegistry.get(resolvedIntent.intentName);
    if (!intent) return [];

    const toolParams = {};
    let expansionParam = null;
    let expansionValues = [];

    // 1. First pass: map params and identify expansion needed
    for (const [intentParam, mapping] of Object.entries(intent.paramMap)) {
        // Handle both string mapping 'tool_param' and object mapping { target: 'tool_param', expand: true }
        const toolParam = typeof mapping === 'object' ? mapping.target : mapping;
        const shouldExpand = typeof mapping === 'object' && mapping.expand;

        const value = resolvedIntent.parameters[intentParam];

        if (value !== null && value !== undefined) {
            if (shouldExpand && Array.isArray(value)) {
                expansionParam = toolParam;
                expansionValues = value;
            } else {
                toolParams[toolParam] = value;
            }
        }
    }

    // 2. Apply defaults for any missing mapped params (post-scoring)
    for (const [intentParam, mapping] of Object.entries(intent.paramMap)) {
        const toolParam = typeof mapping === 'object' ? mapping.target : mapping;

        if (toolParams[toolParam] === undefined && (!expansionParam || toolParam !== expansionParam)) {
            const paramDef = intent.parameters[intentParam];
            if (paramDef && paramDef.default !== undefined) {
                toolParams[toolParam] = paramDef.default;
            }
        }
    }

    // 3. Generate tool calls
    // If we found an expansion parameter (e.g. product_id list), generate one call per item
    if (expansionParam && expansionValues.length > 0) {
        return expansionValues.map(val => ({
            tool: intent.toolName,
            params: { ...toolParams, [expansionParam]: val },
            reason: resolvedIntent.intentName
        }));
    }

    // Single call (standard case, or if expansion param was missing/empty)
    return [{
        tool: intent.toolName,
        params: toolParams,
        reason: resolvedIntent.intentName
    }];
}

/**
 * Map an array of resolved intents to tool calls.
 * Filters out any that can't be mapped.
 * 
 * @param {Array} resolvedIntents - Array of { intentName, score, parameters }
 * @returns {Array} - Array of { tool, params, reason }
 */
function mapToTools(resolvedIntents) {
    // flatMap flattens the arrays returned by mapToTool (supporting expansion)
    return resolvedIntents.flatMap(intent => mapToTool(intent));
}

module.exports = { mapToTool, mapToTools };
