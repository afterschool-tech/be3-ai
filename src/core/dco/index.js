/**
 * Dynamic Context Orchestrator (DCO)
 * 
 * Intent-aware prompt assembly engine that replaces the monolithic personality prompt.
 * Selects composable prompt segments, manages conversation history windowing,
 * and decides store context injection based on intent config.
 */

const { SEGMENTS } = require('./promptSegments');
const { getUltraLeanContext, getLeanContext } = require('../../context/storeContext');

/**
 * Default DCO config for intents that don't define one.
 */
const DEFAULT_DCO = {
    segments: ['core', 'formatting', 'grounding', 'suggestions'],
    storeContext: 'none',
    historyDepth: 4,
    includeSummary: true,
    maxResponseTokens: 1024
};

/**
 * Intent config registry is loaded lazily from the intent config files.
 * We cache the dco fields here after first load.
 */
let intentDcoCache = null;

function loadIntentDcoConfigs() {
    if (intentDcoCache) return intentDcoCache;

    const fs = require('fs');
    const path = require('path');
    const configDir = path.join(__dirname, '../../services/intentResolver/config/intents');

    intentDcoCache = {};

    try {
        const files = fs.readdirSync(configDir).filter(f => f.endsWith('.js'));
        for (const file of files) {
            try {
                const config = require(path.join(configDir, file));
                if (config.name && config.dco) {
                    intentDcoCache[config.name] = config.dco;
                }
            } catch (e) {
                // Skip broken configs silently
            }
        }
    } catch (e) {
        console.warn('[DCO] Could not load intent configs:', e.message);
    }

    return intentDcoCache;
}

/**
 * Get the DCO config for a given intent.
 * Falls back to DEFAULT_DCO if the intent doesn't define one.
 */
function getDcoConfig(intentName) {
    const configs = loadIntentDcoConfigs();
    const intentDco = configs[intentName];

    if (!intentDco) return { ...DEFAULT_DCO };

    return {
        segments: intentDco.segments || DEFAULT_DCO.segments,
        storeContext: intentDco.storeContext || DEFAULT_DCO.storeContext,
        historyDepth: intentDco.historyDepth ?? DEFAULT_DCO.historyDepth,
        includeSummary: intentDco.includeSummary ?? DEFAULT_DCO.includeSummary,
        maxResponseTokens: intentDco.maxResponseTokens ?? DEFAULT_DCO.maxResponseTokens
    };
}

/**
 * Context level priority for escalation during multi-intent merge.
 */
const CONTEXT_PRIORITY = { none: 0, lean: 1, full: 2 };

/**
 * Merge DCO configs from multiple intents (stacked intent support).
 * 
 * Strategy:
 *   - segments: UNION of all intent segments (de-duped, order preserved)
 *   - storeContext: highest level wins (none < lean < full)
 *   - historyDepth: MAX across all intents
 *   - includeSummary: true if ANY intent wants it
 *   - maxResponseTokens: MAX across all intents
 * 
 * @param {string|string[]} intentNames - Single intent or array of stacked intents
 * @returns {Object} Merged DCO config
 */
function getMergedDcoConfig(intentNames) {
    const names = Array.isArray(intentNames) ? intentNames : [intentNames];

    if (names.length === 0) return { ...DEFAULT_DCO };
    if (names.length === 1) return getDcoConfig(names[0]);

    const configs = names.map(n => getDcoConfig(n));

    // Union segments while preserving order (first occurrence wins position)
    const segmentSet = new Set();
    const mergedSegments = [];
    for (const cfg of configs) {
        for (const seg of cfg.segments) {
            if (!segmentSet.has(seg)) {
                segmentSet.add(seg);
                mergedSegments.push(seg);
            }
        }
    }

    // Escalate context level
    let highestContext = 'none';
    for (const cfg of configs) {
        if ((CONTEXT_PRIORITY[cfg.storeContext] || 0) > (CONTEXT_PRIORITY[highestContext] || 0)) {
            highestContext = cfg.storeContext;
        }
    }

    return {
        segments: mergedSegments,
        storeContext: highestContext,
        historyDepth: Math.max(...configs.map(c => c.historyDepth)),
        includeSummary: configs.some(c => c.includeSummary),
        maxResponseTokens: Math.max(...configs.map(c => c.maxResponseTokens))
    };
}

/**
 * Assembles the full system prompt from intent-specific segments + tool results.
 * Supports single intent or array of stacked intents (multi-intent merge).
 * 
 * @param {string|string[]} intentNames - Resolved intent name(s)
 * @param {string} toolResultsSummary - JSON string of summarized tool results
 * @param {Object} options - Additional options
 * @param {string} [options.similarityRef] - Product name for similarity framing
 * @param {boolean} [options.hasFailures] - Whether any tools failed
 * @param {boolean} [options.hasSkipped] - Whether any tools were skipped
 * @param {string} [options.skippedMessage] - Message for skipped actions
 * @param {string[]} [options.failedToolsSummary] - Summary of failed tools
 * @param {boolean} [options.visual_search] - Whether this is a visual search result
 * @returns {string} Assembled system prompt
 */
function assemblePrompt(intentNames, toolResultsSummary, options = {}) {
    const dco = getMergedDcoConfig(intentNames);

    if (options.visual_search && !dco.segments.includes('visual_search')) {
        dco.segments.push('visual_search');
    }

    // 1. Build prompt from selected segments
    const promptParts = [];

    for (const segmentKey of dco.segments) {
        const segmentFn = SEGMENTS[segmentKey];
        if (!segmentFn) continue;

        // Some segments need dynamic args
        if (segmentKey === 'similarity' && options.similarityRef) {
            promptParts.push(segmentFn(options.similarityRef));
        } else if (typeof segmentFn === 'function') {
            promptParts.push(segmentFn());
        }
    }

    // --- DYNAMIC SUGGESTIONS GROUNDING ---
    // If toolResultsSummary contains suggested_products, inject mandatory display rules
    if (toolResultsSummary.includes('"suggested_products"') && !dco.segments.includes('suggested_products_grounding')) {
        const sg = SEGMENTS['suggested_products_grounding'];
        if (sg) promptParts.push(sg());
    }

    // 2. Inject store context if needed
    if (dco.storeContext !== 'none') {
        try {
            const ctx = dco.storeContext === 'full' ? getLeanContext() : getUltraLeanContext();
            promptParts.push(`STORE CONTEXT:\n${JSON.stringify(ctx)}`);
        } catch (_) {
            // storeContext may not be loaded (e.g., REPL) — safe to skip
        }
    }

    // 3. Inject rescue context on failures (regardless of storeContext setting)
    if ((options.hasFailures || options.hasSkipped) && dco.storeContext === 'none') {
        try {
            promptParts.push(`RESCUE CONTEXT (for recovery only):\n${JSON.stringify(getUltraLeanContext())}`);
        } catch (_) { }
    }

    // 4. Inject skipped/failed action instructions
    if (options.hasSkipped && options.skippedMessage) {
        promptParts.push(`SKIPPED ACTIONS: Some add-to-cart actions were skipped because the item wasn't resolved yet. You MUST tell the user: "${options.skippedMessage}" so they know to say "add the first one" or "add the white one" in their next message.`);
    }

    if (options.hasFailures && options.failedToolsSummary) {
        promptParts.push(`TOOL FAILURES: One or more tools failed. Acknowledge the failure(s) clearly. Say what succeeded AND what failed. Suggest a next step. Do NOT pretend the failed action worked.\nFailed: ${JSON.stringify(options.failedToolsSummary)}`);
    }

    // 5. Append tool results
    promptParts.push(`TOOL RESULTS DATA:\n${toolResultsSummary}`);

    // 6. Adaptive verbosity hint
    promptParts.push(`VERBOSITY: Be adaptive. Simple question → short and punchy. Details/comparison → be descriptive. Be smart about length.`);

    return promptParts.join('\n\n');
}

/**
 * Returns the optimal conversation history window.
 * Uses summary + recent N messages instead of raw last-10.
 * Supports single intent or array of stacked intents.
 * 
 * @param {string|string[]} intentNames - Resolved intent name(s)
 * @param {Array} fullHistory - Array of { role, text } objects
 * @param {string|null} conversationSummary - Existing conversation summary
 * @returns {Array} Messages array for LLM (role/content format)
 */
function getHistoryWindow(intentNames, fullHistory = [], conversationSummary = null) {
    const dco = getMergedDcoConfig(intentNames);
    const history = fullHistory || [];

    const messages = [];

    // Inject conversation summary as a system-level context if available and configured
    if (dco.includeSummary && conversationSummary && conversationSummary.trim().length > 0) {
        messages.push({
            role: 'system',
            content: `CONVERSATION CONTEXT: ${conversationSummary}`
        });
    }

    // Append only the last N raw messages (N = historyDepth from DCO config)
    const recentHistory = history.slice(-dco.historyDepth);
    for (const h of recentHistory) {
        messages.push({
            role: h.role === 'ai' ? 'assistant' : 'user',
            content: h.text
        });
    }

    return messages;
}

/**
 * Determines what store context level to inject for a given intent.
 * @param {string} intentName
 * @returns {'none'|'lean'|'full'}
 */
function getContextLevel(intentName) {
    const dco = getDcoConfig(intentName);
    return dco.storeContext;
}

/**
 * Returns the max response tokens for a given intent.
 * @param {string} intentName
 * @returns {number}
 */
function getMaxResponseTokens(intentName) {
    const dco = getDcoConfig(intentName);
    return dco.maxResponseTokens;
}

/**
 * Clears the cached intent DCO configs (useful after hot-reload).
 */
function clearCache() {
    intentDcoCache = null;
}

module.exports = {
    assemblePrompt,
    getHistoryWindow,
    getContextLevel,
    getMaxResponseTokens,
    getDcoConfig,
    getMergedDcoConfig,
    clearCache,
    DEFAULT_DCO
};
