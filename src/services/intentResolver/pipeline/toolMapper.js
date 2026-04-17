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
            // Treat empty arrays as "unset" so they don't overwrite more informative values.
            // Example: products: [] and product_name: "infinix" both map to query.
            if (Array.isArray(value) && value.length === 0) {
                continue;
            }
            if (shouldExpand && Array.isArray(value)) {
                expansionParam = toolParam;
                expansionValues = value;
            } else {
                // When multiple params map to same target (e.g. products + product_name → product_ids),
                // prefer array over string to avoid overwriting resolved arrays with concatenated strings
                const existing = toolParams[toolParam];
                const isArray = Array.isArray(value);
                const existingIsArray = Array.isArray(existing);

                // Prefer arrays over strings: if existing is array and new value is string, skip
                if (existingIsArray && !isArray) {
                    // But if the existing array is empty, allow the string to replace it.
                    if (existing.length === 0) {
                        toolParams[toolParam] = value;
                    }
                    continue; // Keep array (unless empty), don't overwrite with string
                }
                // Prefer arrays over strings: if new value is array and existing is string, overwrite
                if (isArray && !existingIsArray && existing !== undefined) {
                    toolParams[toolParam] = value;
                    continue;
                }
                toolParams[toolParam] = value;
            }
        }
    }

    // 1.5. Pass through internal parameters (prefixed with _)
    // This allows pipeline flags like _from_context to reach the tool handler.
    for (const [key, value] of Object.entries(resolvedIntent.parameters)) {
        if (key.startsWith('_')) {
            toolParams[key] = value;
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

    const portedFrom = resolvedIntent._ported_from || null;
    
    // Debug: log ported intents
    if (portedFrom) {
        console.log(`[ToolMapper] ✅ Found _ported_from: ${resolvedIntent.intentName} (from ${portedFrom})`);
    }

    // 3. Generate tool calls
    // If we found an expansion parameter (e.g. product_id list), generate one call per item
    if (expansionParam && expansionValues.length > 0) {
        return expansionValues.map(val => ({
            tool: intent.toolName,
            params: {
                ...toolParams,
                // Safe Expansion: if we have a specific scalar value (e.g. from microstate)
                // and a single-item expansion list for the same key, prefer the specific value.
                [expansionParam]: (expansionValues.length === 1 && toolParams[expansionParam]) ? toolParams[expansionParam] : val
            },
            reason: resolvedIntent.intentName,
            portedFrom,
            statementText: resolvedIntent.statementText
        }));
    }

    // Single call (standard case, or if expansion param was missing/empty)
    return [{
        tool: intent.toolName,
        params: toolParams,
        reason: resolvedIntent.intentName,
        portedFrom,
        statementText: resolvedIntent.statementText
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
