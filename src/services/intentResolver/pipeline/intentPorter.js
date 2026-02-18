/**
 * Pipeline Stage 7.5: Intent Porter
 * Refines/Pivots intents after scoring, based on state and keywords.
 * 
 * Logic:
 * - Discovery Precedence: If matched keywords contain "discovery" words (show, find, search), DO NOT port.
 * - Purchase Pivot: If intent is product_search AND matched keywords contain purchase words (buy, get, purchase):
 *     - If product name exists in state.reference_map (as a slug), port to add_to_cart.
 */

const { logDebug } = require('../../../utils/debugLogger');

const purchaseVerbs = ['buy', 'purchase', 'get', 'grab', 'take', 'order', 'add', 'cart', 'cop', 'take it'];
const discoveryVerbs = ['show', 'see', 'find', 'search', 'look', 'browse', 'details', 'info', 'specs', 'check out'];

function portIntents(intents, state) {
    if (!intents || intents.length === 0) return intents;

    const referenceMap = state.reference_map || {};

    return intents.map(intent => {
        // We only port from product_search for now
        if (intent.intentName !== 'product_search') return intent;

        const keywords = (intent.matchedKeywords || []).map(k => k.toLowerCase());

        // 1. Check for discovery precedence first
        const hasDiscoveryVerb = keywords.some(k => discoveryVerbs.includes(k));
        if (hasDiscoveryVerb) {
            return intent; // Strictly discovery
        }

        // 2. Check for purchase pivot
        const hasPurchaseVerb = keywords.some(k => purchaseVerbs.includes(k));
        if (!hasPurchaseVerb) {
            return intent; // Neither purchase nor discovery (likely implicit search)
        }

        // 3. Identification: Does the product exist in the reference map?
        const productName = intent.parameters?.product_name;
        if (!productName) return intent;

        const productSlug = productName.toLowerCase().trim().replace(/\s+/g, '_');
        const rawLower = productName.toLowerCase().trim();

        const knownId = referenceMap[productSlug] || referenceMap[rawLower] || referenceMap[productName];

        if (knownId) {
            logDebug('PIPELINE:STAGE7.5_INTENT_PORTING', {
                from: 'product_search',
                to: 'add_to_cart',
                reason: 'Product Known in Session History',
                product: productName,
                slug: productSlug,
                productId: knownId
            });

            console.log(`[IntentPorter] 🚀 Porting search -> add_to_cart (Product Known: ${productName})`);

            return {
                ...intent,
                intentName: 'add_to_cart',
                score: intent.score + 1,
                parameters: {
                    ...intent.parameters,
                    product_id: knownId,
                    products: [knownId]
                }
            };
        }

        return intent;
    });
}

module.exports = { portIntents };
