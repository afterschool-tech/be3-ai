/**
 * Deterministic Resolver (Zero-AI Service)
 * 
 * Provides a 100% Zero-AI entry point for intent resolution and tool selection.
 * Uses the mathematical keyword bench and regex patterns for resolving user intent.
 */

const { resolveAndMap } = require('../services/intentResolver');
const { CATEGORIES, VENDORS, ATTRIBUTES, COLLECTIONS } = require('../context/storeContext');
const { logDebug } = require('../utils/debugLogger');

/**
 * Resolve tools and intents without any AI calls.
 * @param {string} userMessage 
 * @param {object} state 
 * @returns {Promise<object>} { tools, intents, confidence }
 */
async function resolveDeterministic(userMessage, state) {
    const storeContext = {
        CATEGORIES,
        VENDORS,
        ATTRIBUTES,
        COLLECTIONS
    };

    logDebug('DETERMINISTIC_RESOLVER:INPUT', {
        userMessage,
        sessionId: state?.sessionId,
        historyLength: state?.conversation_history?.length || 0,
        lastIntent: state?.current_intent,
        cartItems: state?.cart?.item_count || 0,
        productContext: state?.product_context ? {
            lastSearch: state.product_context.last_search?.query,
            viewing: state.product_context.currently_viewing?.name
        } : null
    });

    const result = await resolveAndMap(
        userMessage,
        state,
        null, // AI Query Function - NULL means ZERO AI
        storeContext
    );

    const output = {
        tools: result.tools || [],
        intent: result.intents?.[0]?.intentName || 'unknown',
        confidence: result.intents?.[0]?.score || 0,
        result: result
    };

    logDebug('DETERMINISTIC_RESOLVER:OUTPUT', {
        intent: output.intent,
        confidence: output.confidence,
        toolCount: output.tools.length,
        tools: output.tools.map(t => ({ tool: t.tool, params: t.params })),
        corrections: result.corrections,
        resolutions: result.resolutions,
        isMultiIntent: result.isMultiIntent,
        allIntents: result.intents?.map(i => ({
            name: i.intentName,
            score: i.score,
            params: i.parameters,
            keywords: i.matchedKeywords
        }))
    });

    return output;
}

module.exports = { resolveDeterministic };
