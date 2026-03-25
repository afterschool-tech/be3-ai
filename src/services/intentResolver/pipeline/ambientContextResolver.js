/**
 * Ambient Context Resolver (Stage 2.5)
 * 
 * Logic to inject browsing context into the pipeline when user signals are low.
 */

const stateManager = require('../../../state/stateManager');

/**
 * Builds "phantom entities" from an active topic object.
 * 
 * @param {object} topic - The topic object from state
 * @param {object} state - Full user state for name reconciliation
 * @param {function} reconcileFn - Function to resolve names from IDs
 * @returns {Array} List of phantom entities
 */
function buildAmbientEntities(topic, state = {}, reconcileFn = null) {
    if (!topic) return [];

    const entities = [];
    const source = "AMBIENT_CONTEXT";

    switch (topic.type) {
        case "product":
            // Inject category and active attributes
            if (topic.category_id) {
                entities.push({
                    type: "category",
                    value: topic.category_label || topic.category_id,
                    categoryId: topic.category_id,
                    source
                });
            }
            if (topic.attributes && typeof topic.attributes === 'object') {
                Object.entries(topic.attributes).forEach(([key, val]) => {
                    if (val) {
                        entities.push({
                            type: "attribute",
                            attributeCode: key,
                            value: val,
                            source
                        });
                    }
                });
            }
            break;

        case "single_product":
            // Inject resolved product
            if (topic.product_id) {
                const name = topic.product_name || (reconcileFn ? reconcileFn(state, topic.product_id) : null);
                entities.push({
                    type: "resolved_product",
                    value: name || topic.product_id,
                    productId: topic.product_id,
                    source
                });
            }
            break;

        case "vendor":
            // Inject vendor
            if (topic.vendor) {
                entities.push({
                    type: "vendor",
                    value: topic.vendor,
                    source
                });
            }
            break;

        case "comparison":
            // Inject multiple products
            if (Array.isArray(topic.product_ids)) {
                topic.product_ids.forEach(pid => {
                    const name = reconcileFn ? reconcileFn(state, pid) : null;
                    entities.push({
                        type: "resolved_product",
                        value: name || pid,
                        productId: pid,
                        source
                    });
                });
            }
            break;

        case "cart":
        case "order":
            // These inject metadata into the LLM context rather than entities
            // (Handled by the prompt constructor later)
            break;
    }

    return entities;
}

/**
 * Resolve Ambient Context Stage.
 * 
 * @param {string} text - Cleaned statement text
 * @param {Array} entities - Currently extracted entities
 * @param {object} state - Full user state
 * @returns {object|Array} Returns entities or a pendingAmbient object
 */
async function resolveAmbientContext(text, entities, state) {
    const { logDebug } = require('../../../utils/debugLogger');

    // Condition 1: If strong entities (Product or Category) already exist, we don't inject
    // (We allow injection if there are only weak entities like attributes or vendors)
    const hasStrongEntity = entities && entities.some(e => 
        e.type === 'category' || 
        e.type === 'resolved_product' || 
        e.type === 'product'
    );

    if (hasStrongEntity) {
        logDebug('PIPELINE:STAGE2.5_SKIP_STRONG_ENTITY', {
            _desc: 'Ambient Context skipped - strong entity already present',
            entities: entities.map(e => ({ type: e.type, value: e.value }))
        });
        return entities;
    }

    const topic = await stateManager.getActiveTopic(state.user_id);
    if (!topic) {
        if (state.active_topic) {
            // Topic exists but maybe getActiveTopic considered it stale/missing?
            logDebug('PIPELINE:STAGE2.5_TOPIC_MISSING', {
                _desc: 'Ambient Context skipped - topic missing or stale in state',
                userId: state.user_id
            });
        }
        return entities;
    }

    // We return a "pending" marker. The final injection happens in index.js
    // after the Transformer runs and the confidence gap is known.
    return { pendingAmbient: topic };
}

module.exports = {
    resolveAmbientContext,
    buildAmbientEntities
};
