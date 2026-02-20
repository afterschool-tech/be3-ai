/**
 * Pipeline Stage 4b: Schema Resolver
 * Matches extracted entities against intent parameter schemas to find the best intent.
 * 
 * Strategy:
 *   1. For each intent, compute "schema fit" based on how many required/optional
 *      params are fulfilled by the extracted entities.
 *   2. Hard-eliminate intents with unfulfilled required params (when entities provide no match).
 *   3. Add IDF-weighted action verb confirmation for tie-breaking.
 *   4. Semantic discovery as LAST RESORT only when no schema match found.
 * 
 * Imports: intentRegistry, semanticScorer (fallback only)
 * Returns: { winner: Object, candidates: Array }
 */

const intentRegistry = require('../config/intentRegistry');

// ── Entity-type to parameter-name mapping ──
// Maps entity types from entityExtractor to the parameter names used in intent schemas
const ENTITY_TO_PARAM = {
    'vendor': 'vendor',
    'category': 'category',
    'brand': 'brand',     // Note: brand maps to attributes.brand via normalizer
    'order_id': 'order_id',
    'quantity': 'quantity',
    'price_max': 'price_max',
    'price_min': 'price_min'
};

// ── Action category to intent name mapping ──
// Maps the action verb categories (from entityExtractor) to likely intent groups
const ACTION_TO_INTENTS = {
    'purchase': ['product_search'],  // "buy" → search first; intentPorter pivots to cart
    'cart_add': ['add_to_cart'],
    'cart_view': ['view_cart'],
    'cart_remove': ['remove_from_cart'],
    'cart_update': ['update_cart_quantity'],
    'discovery': ['product_search', 'browse_collection', 'vendor_products', 'discovery_sentinel'],
    'contact': ['vendor_contact'],
    'tracking': ['order_status'],
    'checkout': ['start_checkout'],
    'info': ['vendor_info', 'get_help'],
    'help': ['get_help'],
    'end': ['end_conversation'],
    'compare': ['product_compare'],
    'feedback': ['give_feedback'],
    'advice': ['get_advice'],
    'list': ['list_vendors', 'list_orders', 'browse_collection'],
    'availability': ['check_availability'],
    'confirm': ['confirm_order'],
    'cancel': ['cancel_order'],
    'delivery': ['set_delivery']
};


/**
 * Resolve the best intent given extracted entities.
 * 
 * @param {Object} extractionResult - From entityExtractor: { entities, residualWords }
 * @param {string} text - Original cleaned text
 * @param {Object} idfMap - IDF weights from intentRegistry.buildIdfMap()
 * @param {Object} storeContext - Store context
 * @returns {Object} { winner, candidates, fallbackUsed }
 */
function resolveIntent(extractionResult, text, idfMap = {}, storeContext = {}) {
    const { entities, residualWords } = extractionResult;
    const allIntents = intentRegistry.getAll();

    // ── Phase 1: Build entity-to-param map ──
    const entityParams = {};  // paramName → entity value
    const entityTypes = new Set();
    const actionEntities = [];

    for (const entity of entities) {
        if (entity.type === 'action') {
            actionEntities.push(entity);
        } else {
            const paramName = ENTITY_TO_PARAM[entity.type];
            if (paramName) {
                entityParams[paramName] = entity;
                entityTypes.add(entity.type);
            }
        }
    }

    // If there are residual words, they could be product names
    if (residualWords.length > 0) {
        entityParams['product_name'] = {
            type: 'product_name',
            value: residualWords.join(' '),
            source: 'residual'
        };
    }

    // ── Phase 2: Compute action intent set ──
    // Determine which intents are suggested by the detected action verbs
    const actionSuggestedIntents = new Set();
    let bestActionIdf = 0;

    // Cart specificity rule: if a specific cart verb (cart_add, cart_remove, cart_update)
    // coexists with generic 'cart_view', suppress the generic one.
    // "bump my cart" → bump=cart_update + cart=cart_view → only cart_update should contribute.
    const actionCategories = new Set(actionEntities.map(a => a.category));
    const specificCartOps = ['cart_add', 'cart_remove', 'cart_update'];
    const hasSpecificCartOp = specificCartOps.some(op => actionCategories.has(op));

    for (const action of actionEntities) {
        // Skip generic cart_view when a specific cart operation is present
        if (action.category === 'cart_view' && hasSpecificCartOp) continue;

        const suggestedIntents = ACTION_TO_INTENTS[action.category] || [];
        suggestedIntents.forEach(i => actionSuggestedIntents.add(i));
        if (action.idf > bestActionIdf) bestActionIdf = action.idf;
    }

    // ── Phase 3: Score each intent ──
    const scored = [];

    for (const [intentName, intent] of Object.entries(allIntents)) {
        const params = intent.parameters || {};
        let score = 0;
        let requiredFilled = 0;
        let requiredTotal = 0;
        let optionalFilled = 0;
        let optionalTotal = 0;
        let hasUnfilledRequired = false;
        const matchedParams = {};
        const matchedKeywords = [];

        // 3a. Schema Fit: Check each parameter against extracted entities
        for (const [paramName, paramDef] of Object.entries(params)) {
            if (paramDef.required) {
                requiredTotal++;
                if (entityParams[paramName]) {
                    requiredFilled++;
                    matchedParams[paramName] = entityParams[paramName].value || entityParams[paramName].id;
                } else {
                    hasUnfilledRequired = true;
                }
            } else {
                optionalTotal++;
                if (entityParams[paramName]) {
                    optionalFilled++;
                    matchedParams[paramName] = entityParams[paramName].value || entityParams[paramName].id;
                }
            }
        }

        // 3b. Schema Score
        // Required slots filled: +2.0 each
        score += requiredFilled * 2.0;
        // Optional slots filled: +0.5 each
        score += optionalFilled * 0.5;

        // 3c. Action Verb Boost: If action verbs suggest this intent
        if (actionSuggestedIntents.has(intentName)) {
            // Add the IDF of the matching action verb(s)
            for (const action of actionEntities) {
                const suggested = ACTION_TO_INTENTS[action.category] || [];
                if (suggested.includes(intentName)) {
                    score += action.idf;
                    matchedKeywords.push(action.verb);
                }
            }
        }

        // 3d. IDF Keyword Match (beyond action verbs): Check intent keywords against text words
        const textWords = text.toLowerCase().split(/\s+/);
        for (const kw of (intent.keywords || [])) {
            const kwLower = kw.toLowerCase();
            if (textWords.includes(kwLower) && !matchedKeywords.includes(kwLower)) {
                const kwIdf = idfMap[kwLower] || 0.5;
                score += kwIdf;
                matchedKeywords.push(kwLower);
            }
        }

        // 3e. Multi-word synonym match (bonus for phrase-level matches)
        for (const syn of (intent.synonyms || [])) {
            if (syn.includes(' ') && text.toLowerCase().includes(syn.toLowerCase())) {
                score += 1.5; // Multi-word synonym is a strong signal
                matchedKeywords.push(syn);
            }
        }

        // 3f. Penalty: If intent has required params but entities don't provide ANY relevant type
        // Only penalize if we actually have entities AND no action verb directly points here.
        // When action verbs directly suggest this intent, the missing param will be filled
        // downstream by parameterExtractor or AI — don't penalize the verb's signal.
        const actionDirectlySupports = actionSuggestedIntents.has(intentName);
        if (hasUnfilledRequired && requiredFilled === 0 && entities.length > 0 && !actionDirectlySupports) {
            score -= 5.0; // Hard penalty for zero required match with no action backup
        }


        // 3g. Vendor Boost: If a vendor entity is detected AND this intent uses vendor param
        if (entityParams['vendor'] && params.vendor) {
            // Check if it's an official store tenant
            if (storeContext.VENDORS) {
                const vendorEntity = entityParams['vendor'];
                const isOfficial = Object.values(storeContext.VENDORS).some(v =>
                    v.id === vendorEntity.id
                );
                if (isOfficial) {
                    score += 1.0; // Official tenant confirmation boost
                }
            }
        }

        // 3h. Zero-param intents with no action match get a baseline penalty
        // Prevents intents like get_help/end_conversation from competing via keyword overlap
        if (Object.keys(params).length === 0 && !actionSuggestedIntents.has(intentName)) {
            score -= 2.0;
        }

        scored.push({
            intentName,
            score,
            matchedKeywords,
            matchedParams,
            requiredFilled,
            requiredTotal,
            optionalFilled,
            keywordScore: score, // For compatibility with downstream stages
            invertedFrom: null
        });
    }

    // ── Phase 4: Sort and select winner ──
    scored.sort((a, b) => b.score - a.score);

    // Filter to only positive-scoring candidates
    const validCandidates = scored.filter(c => c.score > 0);

    // ── Phase 5: Fallback to semantic discovery if nothing scored positive ──
    let fallbackUsed = false;
    if (validCandidates.length === 0) {
        try {
            const semanticScorer = require('./semanticScorer');
            if (semanticScorer && semanticScorer.discoverCandidates) {
                const semanticCandidates = semanticScorer.discoverCandidates(text);
                for (const sc of semanticCandidates) {
                    validCandidates.push({
                        intentName: sc.intentName,
                        score: sc.keywordScore || sc.score || 1.0,
                        matchedKeywords: ['semantic'],
                        matchedParams: {},
                        requiredFilled: 0,
                        requiredTotal: 0,
                        optionalFilled: 0,
                        keywordScore: sc.keywordScore || sc.score || 1.0,
                        invertedFrom: null
                    });
                }
                fallbackUsed = true;
            }
        } catch (e) {
            // Semantic scorer not available — that's fine
        }
    }

    // ── Phase 6: Product search fallback for residual product words ──
    // If we have residual words (likely product names) but no strong winner,
    // ensure product_search is in the candidates
    if (residualWords.length > 0 && !validCandidates.some(c => c.intentName === 'product_search' && c.score > 1)) {
        const existing = validCandidates.find(c => c.intentName === 'product_search');
        if (!existing) {
            validCandidates.push({
                intentName: 'product_search',
                score: 0.5,
                matchedKeywords: ['orphan_product'],
                matchedParams: { product_name: residualWords.join(' ') },
                requiredFilled: 0,
                requiredTotal: 0,
                optionalFilled: 1,
                keywordScore: 0.5,
                invertedFrom: null
            });
        }
    }

    const winner = validCandidates.length > 0 ? validCandidates[0] : null;

    return {
        winner,
        candidates: validCandidates.slice(0, 5), // Top 5 for diagnostics
        fallbackUsed,
        extractedEntities: entities,
        residualWords
    };
}

module.exports = { resolveIntent, ACTION_TO_INTENTS };
