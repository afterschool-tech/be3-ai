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
const { logDebug } = require('../../../utils/debugLogger');
const { isRoot } = require('../../../context/categoryHelpers');
// ── Entity-type to parameter-name mapping ──
// Maps entity types from entityExtractor to the parameter names used in intent schemas
const ENTITY_TO_PARAM = {
    'vendor': 'vendor',
    'category': 'category',
    'brand': 'brand',     // Note: brand maps to attributes.brand via normalizer
    'order_id': 'order_id',
    'quantity': 'quantity',
    'price_max': 'price_max',
    'price_min': 'price_min',
    'clause': 'clause_words',
    'resolved_product': 'product_name'  // Context-resolved products → product_name slot
};

// ── Action category to intent name mapping ──
// Maps the action verb categories (from entityExtractor) to likely intent groups
const ACTION_TO_INTENTS = {
    'purchase': ['product_search'],  // "buy" → search first; intentPorter pivots to cart
    'cart_add': ['add_to_cart'],
    'cart_view': ['view_cart'],
    'cart_remove': ['remove_from_cart'],
    'cart_update': ['update_cart_quantity'],
    'discovery': ['product_search', 'browse_collection', 'vendor_products'],
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

    const textLower = String(text || '').toLowerCase();

    const tokenize = (s) => String(s || '').toLowerCase().split(/\s+/).map(x => x.trim()).filter(Boolean);
    const textWords = tokenize(textLower);

    const intentKeywordTokenSet = (intent) => {
        const out = new Set();
        for (const kw of (intent.keywords || [])) {
            tokenize(kw).forEach(t => out.add(t));
        }
        for (const syn of (intent.synonyms || [])) {
            tokenize(syn).forEach(t => out.add(t));
        }
        return out;
    };

    const nonSearchHitIntents = new Set();
    const nonSearchHitTokens = new Set();
    for (const intent of Object.values(allIntents)) {
        if (!intent || intent.name === 'product_search') continue;
        let hit = false;
        for (const kw of (intent.keywords || [])) {
            const kwLower = String(kw || '').toLowerCase();
            if (kwLower && textWords.includes(kwLower)) {
                hit = true;
                break;
            }
        }
        if (!hit) {
            for (const syn of (intent.synonyms || [])) {
                const synLower = String(syn || '').toLowerCase();
                if (synLower && synLower.includes(' ') && textLower.includes(synLower)) {
                    hit = true;
                    break;
                }
            }
        }
        if (hit) {
            nonSearchHitIntents.add(intent.name);
            const toks = intentKeywordTokenSet(intent);
            for (const t of toks) nonSearchHitTokens.add(t);
        }
    }

    // Heuristic: comparison/advice requests often don't include an explicit "compare" verb,
    // but do include strong comparison signals ("comparison", "which one should I get").
    // If multiple product-like mentions exist, prefer product_compare over product_search.
    const hasComparisonSignal = /\b(comparison|compare|vs\.?|versus|difference between|difference|between|side by side|which one should i|get based on)\b/i.test(textLower);
    const productLikeMentions = (textLower.match(/\b(iphone|galaxy|samsung|infinix|tecno|itel|pixel|macbook|ipad|air|pro|max|ultra)\b/g) || []).length;
    const likelyMultiProductRequest = productLikeMentions >= 2;

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

    const getCategoryQuality = () => {
        const cat = entityParams['category'];
        if (!cat) return 0;
        const q = Number(cat.quality);
        if (!Number.isFinite(q)) return 1.0;
        return Math.max(0, Math.min(1, q));
    };

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

    const hasPurchaseAction = actionCategories.has('purchase');

    const hasCartRemoveAction = actionCategories.has('cart_remove');

    // Compare action should dominate ambiguous discovery signals.
    // Example: "Compare them" may expand into product names containing brand tokens (e.g. "Infinix")
    // which can look like a search refinement. If the user explicitly said "compare", we should
    // strongly prefer product_compare over product_search.
    const hasCompareAction = actionCategories.has('compare');

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
            const entity = entityParams[paramName];
            if (entity) {
                // Strict Type Rule: Categories belong in category slots.
                // Never allow a category entity to masquerade as a required product name.
                if (entity.type === 'category' && (paramName === 'product_name' || paramName === 'products')) {
                    if (paramDef.required) hasUnfilledRequired = true;
                    continue;
                }

                const isCategorySlot = paramName === 'category' && entity.type === 'category';
                const catQuality = isCategorySlot ? getCategoryQuality() : 1.0;

                if (paramDef.required) {
                    requiredFilled++;
                    requiredTotal++;
                    matchedParams[paramName] = entity.id || entity.clauseId || entity.value;
                } else {
                    optionalFilled++;
                    optionalTotal++;
                    matchedParams[paramName] = entity.id || entity.clauseId || entity.value;
                }

                // Category matches should be high recall but not always high authority.
                // Down-weight the schema-fit contribution for low-quality layer2 category matches.
                if (isCategorySlot && catQuality < 1.0) {
                    // We already counted the slot as filled above; compensate by reducing its effective value.
                    // Optional slot base is +0.5. Reduce by (1 - quality) * 0.5.
                    if (!paramDef.required) {
                        score -= (1.0 - catQuality) * 0.5;
                    }
                }
            } else if (paramDef.required) {
                requiredTotal++;
                hasUnfilledRequired = true;
            } else {
                optionalTotal++;
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
        for (const kw of (intent.keywords || [])) {
            const kwLower = kw.toLowerCase();
            if (textWords.includes(kwLower) && !matchedKeywords.includes(kwLower)) {
                const kwIdf = idfMap[kwLower] || 0.5;
                if (intentName === 'vendor_contact') console.log(`[SchemaResolver] Match for vendor_contact: "${kwLower}" in words: [${textWords.join(', ')}] with IDF ${kwIdf}`);
                // Boost for exact keyword matches (especially for test/debug intents)
                const exactMatchBoost = kwLower === textWords.join(' ').trim() ? 3.0 : 0;
                score += kwIdf + exactMatchBoost;
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

        // ── Phase 3f: Intent-Specific Signal Rules ──

        // [Cart Remove Dominance Rule]: if the user explicitly says remove, prioritize remove_from_cart.
        // This prevents false positives where incidental tokens cause product_search to win.
        if (hasCartRemoveAction) {
            if (intentName === 'remove_from_cart') score += 6.0;
            if (intentName === 'product_search' || intentName === 'discovery_sentinel' || intentName === 'browse_collection') score -= 4.0;
        }

        // [Compare-by-signal Rule]: If the user asks for advice "based on comparison" or "which one should I get",
        // and the message looks like it contains multiple product mentions, treat it as compare-first.
        if (hasComparisonSignal && likelyMultiProductRequest) {
            if (intentName === 'product_compare') score += 5.0;
            if (intentName === 'product_search') score -= 2.5;
        }

        // [Compare Dominance Rule]: When the user uses a compare verb, do not let discovery/search
        // intents steal the win just because a brand token or clause is present in the text.
        if (hasCompareAction) {
            if (intentName === 'product_compare') {
                score += 6.0;
            }
            if (intentName === 'product_search' || intentName === 'discovery_sentinel') {
                score -= 4.0;
            }
        }

        // [Discovery Sentinel Suppression]: discovery_sentinel is a port-only intent.
        // It should never win competition directly.
        if (intentName === 'discovery_sentinel') {
            score -= 15.0;
        }

        // [Search-Discovery Rule]: If we have a category AND a clause (e.g. "cheap smartphones"),
        // this is a very strong signal for product_search even without an action verb.
        if (intentName === 'product_search') {
            const hasCategory = extractionResult.entities.some(e => e.type === 'category');
            const hasClause = extractionResult.entities.some(e => e.type === 'clause');
            if (hasCategory && hasClause) {
                score += 2.0;
            }
        }

        // 3g. Penalty: If intent has required params but entities don't provide ANY relevant type
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
        if (Object.keys(params).length === 0 && matchedKeywords.length === 0 && !actionSuggestedIntents.has(intentName)) {
            score -= 2.0;
        }

        // 3i. Discovery vs Identity Bias Correction
        // If a brand is detected without an action verb, user is likely searching, not identifying vendors.
        if (entityParams['brand'] || entityParams['category']) {
            const categoryQuality = getCategoryQuality() || 1.0;
            if (intentName === 'product_search' || intentName === 'discovery_sentinel') {
                score += 1.5 * categoryQuality; // Discovery boost for specific entities
            }
            if (intentName === 'vendor_identity' && !actionSuggestedIntents.has('info')) {
                score -= 2.0; // Identity penalty for brand-only mentions
            }
        }

        // 3j. Hierarchy Boost: Root category alone → boost discovery_sentinel
        // If a root category is mentioned without specific product terms, user wants to browse
        if (entityParams['category'] && isRoot(entityParams['category'].id)) {
            const hasProductTerms = entityParams['product_name'] || entityParams['brand'];
            if (!hasProductTerms && !hasPurchaseAction) {
                if (intentName === 'discovery_sentinel') {
                    score += 2.0;
                    logDebug('SCORING:HIERARCHY_BOOST', {
                        _desc: 'Schema hierarchy boost — root category alone boosts discovery_sentinel',
                        _example: '"Gadgets" without product → discovery_sentinel +2',
                        category: entityParams['category'].value,
                        intent: intentName,
                        boost: 2.0,
                        reason: 'Root category without product terms'
                    });
                }
            }
        }

        // [New] Orphan Noun Rule: product_search should win over vendor_identity for simple product mentions.
        // BUT: Don't apply this boost if another intent has a direct keyword match (e.g., "dami" → test_microstate)
        if (entityParams['product_name'] && entityParams['product_name'].source === 'residual') {
            const productNameLower = entityParams['product_name'].value.toLowerCase();
            const residualTokens = new Set(tokenize(productNameLower));

            // Check if this product name is actually a keyword for another intent
            const isKeywordForOtherIntent = Object.values(allIntents).some(intent => {
                if (intent.name === 'product_search') return false;
                const allKeywords = [...(intent.keywords || []), ...(intent.synonyms || [])];
                return allKeywords.some(kw => kw.toLowerCase() === productNameLower);
            });

            // Option (2): only suppress orphan boost when some other intent actually matched this message,
            // AND the residual contains tokens that belong to those matched intents.
            let residualSupportsOtherIntent = false;
            if (!isKeywordForOtherIntent && nonSearchHitIntents.size > 0) {
                for (const t of residualTokens) {
                    if (nonSearchHitTokens.has(t)) {
                        residualSupportsOtherIntent = true;
                        break;
                    }
                }
            }

            if (intentName === 'product_search') {
                // Only boost if this is NOT a keyword for another intent
                if (!isKeywordForOtherIntent && !residualSupportsOtherIntent) {
                    score += 2.0; // Boost search
                }
            }
            if (intentName === 'vendor_identity') score -= 1.0; // Penalize "guess" identity
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
    // BUT: Skip this if the residual word matches a keyword from another intent (e.g., "dami" → test_microstate)
    const residualText = residualWords.join(' ').toLowerCase().trim();
    const residualIsKeyword = residualText && Object.values(allIntents).some(intent => {
        if (intent.name === 'product_search') return false;
        const allKeywords = [...(intent.keywords || []), ...(intent.synonyms || [])];
        return allKeywords.some(kw => kw.toLowerCase() === residualText);
    });

    if (residualWords.length > 0 && !residualIsKeyword && !validCandidates.some(c => c.intentName === 'product_search' && c.score > 1)) {
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
