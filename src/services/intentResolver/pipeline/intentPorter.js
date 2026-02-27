/**
 * Pipeline Stage 7.5: Intent Porter
 * Refines/Pivots intents after scoring, based on state and keywords.
 *
 * Logic:
 * - Phase 4: Consecutive naked product_search after add_to_cart → port to add_to_cart (one per product).
 * - Discovery Precedence: If matched keywords contain "discovery" words (show, find, search), DO NOT port.
 * - Purchase Pivot: If intent is product_search AND matched keywords contain purchase words:
 *     - If product name exists in state.reference_map, port to add_to_cart.
 */

const { logDebug } = require('../../../utils/debugLogger');

const purchaseVerbs = ['buy', 'purchase', 'get', 'grab', 'take', 'order', 'add', 'cart', 'cop', 'take it', 'want', 'need'];
const discoveryVerbs = ['show', 'see', 'find', 'search', 'look', 'browse', 'details', 'info', 'specs', 'check out'];

function getResolvedProductIdsFromStage2(stage2Resolutions) {
    if (!Array.isArray(stage2Resolutions) || stage2Resolutions.length === 0) return [];
    const ids = [];
    for (const r of stage2Resolutions) {
        const id = r?.productId || r?.product_id || r?.productID || null;
        if (!id) continue;
        const s = String(id).trim();
        if (!s) continue;
        ids.push(s);
    }
    // Dedupe while preserving order
    const out = [];
    const seen = new Set();
    for (const id of ids) {
        if (seen.has(id)) continue;
        seen.add(id);
        out.push(id);
    }
    return out;
}

function hasPurchasePhrasing(intent) {
    const keywords = (intent?.matchedKeywords || []).map(k => String(k || '').toLowerCase());
    if (keywords.some(k => purchaseVerbs.includes(k))) return true;

    const t = String(intent?.statementText || '').toLowerCase();
    if (!t) return false;
    // Light heuristic: purchase verbs + common patterns
    const patterns = [
        /\b(buy|purchase|order|add to cart|add it|add this|add that|grab|cop|get)\b/i,
        /\b(i want|i need|i'll take|i would like|gimme|give me)\b/i
    ];
    return patterns.some(re => re.test(t));
}

/** True if statement looks like a question (don't port "what about X" to add). */
function isQuestionPhrase(text) {
    if (!text || typeof text !== 'string') return false;
    const t = text.toLowerCase().trim();
    return /^(what|how|tell me|could you|can you)\s+(about|are|is)\s+/i.test(t) ||
        /^(what about|how about|what of)\s+/i.test(t) ||
        /^(tell me about)\s+/i.test(t);
}

/** True if this product_search is "naked" — single product reference, no explicit discovery verb. */
function isNakedProductSearch(intent) {
    if (intent.intentName !== 'product_search') return false;
    const keywords = (intent.matchedKeywords || []).map(k => k.toLowerCase());
    const hasDiscovery = keywords.some(k => discoveryVerbs.includes(k));
    if (hasDiscovery) return false;
    const hasProduct = !!(intent.parameters?.product_name || (intent.parameters?.products && intent.parameters.products.length > 0));
    return hasProduct;
}

const stateManager = require('../../../state/stateManager');

async function portIntents(intents, state) {
    if (!intents || intents.length === 0) return intents;

    const referenceMap = state.reference_map || {};
    const lastSearchResults = Array.isArray(state?.product_context?.last_search?.results)
        ? state.product_context.last_search.results
        : [];
    const result = [];
    let prevIntentName = null;

    for (const intent of intents) {
        let out = { ...intent };

        // Phase 4: Consecutive naked product_search after add_to_cart → add_to_cart (one tool call per product)
        if (intent.intentName === 'product_search' && prevIntentName === 'add_to_cart') {
            if (isNakedProductSearch(intent) && !isQuestionPhrase(intent.statementText)) {
                out = {
                    ...intent,
                    intentName: 'add_to_cart',
                    score: (intent.score || 0) + 1,
                    parameters: { ...intent.parameters },
                    _ported_from: 'product_search'
                };
                console.log(`[IntentPorter] ✅ Set _ported_from on intent:`, {
                    intentName: out.intentName,
                    _ported_from: out._ported_from,
                    hasPortedFrom: '_ported_from' in out
                });
                logDebug('PIPELINE:STAGE7.5_PORT_AFTER_ADD', {
                    _desc: 'Intent port after add — port product_search to add_to_cart when following add',
                    _example: '"add samsung" then "also iphone" → port second to add_to_cart',
                    from: 'product_search',
                    to: 'add_to_cart',
                    reason: 'naked product_search after add_to_cart',
                    product: intent.parameters?.product_name || intent.parameters?.products?.[0],
                    statementText: (intent.statementText || '').slice(0, 60)
                });
                console.log(`[IntentPorter] 🚀 Porting search -> add_to_cart (after add: "${(intent.parameters?.product_name || intent.parameters?.products?.[0] || '').toString().slice(0, 40)}")`);
            }
        }

        prevIntentName = out.intentName;

        // Existing: product_search + purchase verb + reference_map
        if (out.intentName === 'product_search') {
            const keywords = (out.matchedKeywords || []).map(k => k.toLowerCase());
            const hasDiscoveryVerb = keywords.some(k => discoveryVerbs.includes(k));
            if (hasDiscoveryVerb) {
                result.push(out);
                continue;
            }

            // NEW: Stage2 resolved productId + purchase phrasing → port to add_to_cart gated by confirmation.
            const stage2Ids = getResolvedProductIdsFromStage2(out.stage2Resolutions);
            if (stage2Ids.length === 1 && hasPurchasePhrasing(out) && !isQuestionPhrase(out.statementText)) {
                const pid = stage2Ids[0];
                const pObj = lastSearchResults.find(p => (p?.id === pid || p?.handle === pid)) || null;
                const confirmContext = pObj ? {
                    product: pObj?.name || pObj?.title || null,
                    price: pObj?.price_display || pObj?.price || null,
                    vendor: pObj?.vendor || pObj?.metadata?.vendor || null
                } : null;
                logDebug('PIPELINE:STAGE7.5_STAGE2_CONFIRM_PORT', {
                    _desc: 'Stage2 porting — resolved productId + purchase phrasing → add_to_cart (confirmation microstate required)',
                    _example: '"i want the cheapest one" (resolved) → confirm → add_to_cart',
                    from: 'product_search',
                    to: 'add_to_cart',
                    reason: 'Stage2 resolved productId',
                    productId: pid,
                    statementText: (out.statementText || '').slice(0, 80)
                });
                result.push({
                    ...out,
                    intentName: 'add_to_cart',
                    score: (out.score || 0) + 1,
                    parameters: {
                        ...out.parameters,
                        product_id: pid,
                        products: [pid],
                        _require_confirmation: true,
                        _confirm_context: confirmContext
                    },
                    _ported_from: 'product_search'
                });
                continue;
            }

            const hasPurchaseVerb = keywords.some(k => purchaseVerbs.includes(k));
            if (!hasPurchaseVerb) {
                result.push(out);
                continue;
            }
            const productName = out.parameters?.product_name;
            if (!productName) {
                result.push(out);
                continue;
            }
            const productSlug = productName.toLowerCase().trim().replace(/\s+/g, '_');
            const rawLower = productName.toLowerCase().trim();
            
            // Step 1: Check user_query_map first (user's terminology, volatile, session-only)
            // This respects how the user actually named the product
            let knownId = null;
            let knownIdSource = null;
            // Get userId from state - check user_id (from resolveAndMap) or userId/sessionId
            const userId = state.user_id || state.userId || state.sessionId || null;
            if (userId) {
                const userQueryResult = await stateManager.resolveUserQuery(userId, productName);
                if (userQueryResult) {
                    // Check if it's a set (comma-separated) or single product
                    const isSet = userQueryResult.includes(',');
                    if (!isSet) {
                        // Single product - safe to port
                        knownId = userQueryResult;
                        knownIdSource = 'user_query_map';
                        console.log(`[IntentPorter] ✅ Found in user_query_map: "${productName}" → ${knownId}`);
                    } else {
                        // Multiple products - don't port (ambiguous)
                        console.log(`[IntentPorter] ⚠️ Found in user_query_map but ambiguous (${userQueryResult.split(',').length} products): "${productName}"`);
                    }
                }
            }
            
            // Step 2: Fallback to reference_map (product names, brand names, etc.)
            if (!knownId) {
                knownId = referenceMap[productSlug] || referenceMap[rawLower] || referenceMap[productName];
                if (knownId) {
                    knownIdSource = 'reference_map';
                }
            }
            
            // Step 3: If still not found, try substring matching in reference_map
            if (!knownId) {
                const queryLower = rawLower;
                for (const [key, value] of Object.entries(referenceMap)) {
                    // Check if reference map key contains the query, or query contains the key
                    // But skip generic keys like "it", "this", "them", "all", etc.
                    const genericKeys = ['it', 'this', 'that', 'them', 'all', 'ones', 'the_ones', 'the_products', 'all_of_them', 
                                       'first', 'second', 'third', 'fourth', 'fifth', 'the_first_one', 'the_second_one', 'the_third_one'];
                    if (genericKeys.includes(key)) continue;
                    
                    // Check if key contains query (e.g., "home_made_spaghetti" contains "spaghetti")
                    if (key.includes(queryLower) || queryLower.includes(key.replace(/_/g, ' '))) {
                        knownId = value;
                        knownIdSource = 'reference_map_substring';
                        console.log(`[IntentPorter] ✅ Found match via substring: "${productName}" matches reference map key "${key}"`);
                        break;
                    }
                }
            }
            
            console.log(`[IntentPorter] 🔍 Checking purchase verb porting for "${productName}":`, {
                hasPurchaseVerb: true,
                productName,
                productSlug,
                rawLower,
                knownId: knownId || 'NOT_FOUND',
                knownIdSource: knownIdSource || 'none',
                referenceMapKeys: Object.keys(referenceMap).slice(0, 10)
            });
            if (knownId) {
                logDebug('PIPELINE:STAGE7.5_INTENT_PORTING', {
                    _desc: 'Intent porting — product_search → add_to_cart when product in user_query_map/reference_map',
                    _example: '"i want to buy drawer" after search → add_to_cart with product_id',
                    from: 'product_search',
                    to: 'add_to_cart',
                    reason: 'Product Known in Session History',
                    product: productName,
                    slug: productSlug,
                    productId: knownId
                });
                console.log(`[IntentPorter] 🚀 Porting search -> add_to_cart (Product Known: ${productName})`);
                const portedIntent = {
                    ...out,
                    intentName: 'add_to_cart',
                    score: (out.score || 0) + 1,
                    parameters: {
                        ...out.parameters,
                        product_id: knownId,
                        products: [knownId]
                    },
                    _ported_from: 'product_search'
                };
                console.log(`[IntentPorter] ✅ Set _ported_from on reference_map ported intent:`, {
                    intentName: portedIntent.intentName,
                    _ported_from: portedIntent._ported_from,
                    hasPortedFrom: '_ported_from' in portedIntent
                });
                result.push(portedIntent);
            } else {
                result.push(out);
            }
        } else {
            result.push(out);
        }
    }

    return result;
}

module.exports = { portIntents };
