/**
 * Microstate Registry
 * Auto-collects microstate trigger declarations from all intent definition files.
 * 
 * Each intent can declare a `microstates: {}` property with named triggers.
 * This registry indexes them for fast lookup by intentName.
 * 
 * Usage:
 *   const { checkTriggers } = require('./microstateRegistry');
 *   const triggered = checkTriggers('add_to_cart', params, entities);
 *   if (triggered) { ... open microstate ... }
 */

const intentRegistry = require('./intentRegistry');
const { logDebug } = require('../../../utils/debugLogger');

// Trigger index: { intentName → { triggerName → triggerDef } }
let triggerIndex = null;

/**
 * Build the trigger index from all intent definitions.
 * Called once at boot (lazy).
 */
function buildIndex() {
    if (triggerIndex) return triggerIndex;

    triggerIndex = {};
    const allIntents = intentRegistry.getAll();

    for (const [intentName, intentDef] of Object.entries(allIntents)) {
        if (intentDef.microstates && typeof intentDef.microstates === 'object') {
            triggerIndex[intentName] = intentDef.microstates;
        }
    }

    const count = Object.keys(triggerIndex).length;
    const triggerCount = Object.values(triggerIndex).reduce((acc, ms) => acc + Object.keys(ms).length, 0);
    console.log(`[MicrostateRegistry] Indexed ${triggerCount} triggers across ${count} intents`);

    return triggerIndex;
}

/**
 * Get all trigger definitions for a specific intent.
 * @param {string} intentName
 * @returns {object|null} Map of triggerName → triggerDef, or null
 */
function getTriggers(intentName) {
    const index = buildIndex();
    return index[intentName] || null;
}

/**
 * Check all triggers for a given intent against current params/entities.
 * Returns the first trigger that fires, or null.
 * 
 * @param {string} intentName - The resolved intent name
 * @param {object} params - Extracted parameters for the intent
 * @param {Array} entities - Extracted entities from entityExtractor
 * @param {any} toolResult - Optional tool execution result (for post-tool triggers)
 * @returns {{ triggerName, triggerDef, buildMicrostate(winner) }|null}
 */
function checkTriggers(intentName, params, entities = [], toolResult = null) {
    const index = buildIndex();
    const triggers = index[intentName];
    if (!triggers) return null;

    for (const [triggerName, triggerDef] of Object.entries(triggers)) {
        try {
            if (triggerDef.trigger(params, entities, toolResult)) {
                logDebug('MICROSTATE:TRIGGER_FIRED', {
                    _desc: 'Microstate trigger fired — intent matched trigger, open microstate',
                    _example: 'remove_from_cart + many items → ordinal_choice trigger',
                    intentName,
                    triggerName,
                    params: Object.keys(params),
                    entityTypes: entities.map(e => e.type)
                });

                return {
                    triggerName,
                    triggerDef,

                    /**
                     * Build a microstate object ready for stateManager.setMicrostate()
                     * @param {object} winner - The resolved intent from the pipeline
                     */
                    buildMicrostate: (winner) => ({
                        type: triggerName,
                        tool: triggerDef.prompt.tool, // Preserve the UI tool type
                        intent: intentName,
                        sandbox: triggerDef.sandbox || 'soft',
                        boostScore: triggerDef.boostScore || 10.0,
                        params: winner.parameters || params,
                        entities: entities,
                        options: triggerDef.prompt?.params?.options || [],
                        // Optional per-microstate extensions
                        validators: triggerDef.validators || {},
                        normalizers: triggerDef.normalizers || {},
                        breakthrough: triggerDef.breakthrough || null,
                        fields: triggerDef.fields || null,
                        features: triggerDef.features || [],
                        currentFieldIndex: 0,
                        contract: {
                            maxMessages: triggerDef.termination?.maxMessages || 3,
                            messagesUsed: 0,
                            onFulfilled: triggerDef.termination?.onFulfilled || [],
                            onKeyword: triggerDef.termination?.onKeyword || ['cancel', 'nevermind', 'stop'],
                            escalation: triggerDef.termination?.escalation || null,
                            onFulfilledSpawn: triggerDef.termination?.onFulfilledSpawn || null
                        }
                    }),

                    /**
                     * The prompt tool call to execute instead of the original intent
                     */
                    prompt: {
                        tool: triggerDef.prompt.tool,
                        params: {
                            ...triggerDef.prompt.params,
                            parentIntent: intentName,
                            controls: { ...(triggerDef.prompt.params?.controls || {}), cancel: true }
                        },
                        reason: `Microstate trigger: ${triggerName}`
                    }
                };
            }
        } catch (err) {
            console.error(`[MicrostateRegistry] Trigger error for ${intentName}.${triggerName}:`, err.message);
        }
    }

    return null;
}

/**
 * Reset the index (for testing/hot-reload)
 */
function resetIndex() {
    triggerIndex = null;
}

module.exports = {
    getTriggers,
    checkTriggers,
    buildIndex,
    resetIndex
};
