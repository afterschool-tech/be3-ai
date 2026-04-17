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
    'resolved_product': 'product_name',  // Context-resolved products → product_name slot
    'facet_target': 'facet_target'       // New: semantic attribute targets
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
    'delivery': ['set_delivery'],
    'discovery_meta': ['facet_list', 'vendor_facet']
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
            if (!kw) continue;
            tokenize(kw).forEach(t => out.add(t));
        }
        for (const syn of (intent.synonyms || [])) {
            if (!syn) continue;
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
            if (typeof kw !== 'string') continue;
            const kwLower = kw.toLowerCase();
            if (!kwLower) continue;
            // Support multi-word keyword phrases (e.g. "similar to") via substring match
            const isMultiWord = kwLower.includes(' ');
            const matched = isMultiWord ? textLower.includes(kwLower) : textWords.includes(kwLower);
            if (matched) {
                hit = true;
                break;
            }
        }
        if (!hit) {
            for (const syn of (intent.synonyms || [])) {
                if (typeof syn !== 'string') continue;
                const synLower = syn.toLowerCase();
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
    // 🛡️ SCORER GUARD: Only populate if the slot isn't already filled by a high-confidence
    // resolved_product (from Context or IntelliSense). This prevents "orphans"
    // from overwriting our vetted product names during scoring.
    if (residualWords.length > 0 && !entityParams['product_name']) {
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
        const breakdown = []; // Detailed scoring audit

        // Helper to add to score and track breakdown
        const applyModifier = (value, reason) => {
            if (value === 0) return;
            score += value;
            breakdown.push({ value, reason });
        };

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
        if (requiredFilled > 0) {
            applyModifier(requiredFilled * 2.0, `Required slot match (${requiredFilled})`);
        }

        // Optional slots filled: +0.5 each
        if (optionalFilled > 0) {
            applyModifier(optionalFilled * 0.5, `Optional slot match (${optionalFilled})`);
        }

        // 3c. Action Verb Boost: If action verbs suggest this intent
        if (actionSuggestedIntents.has(intentName)) {
            // Add the IDF of the matching action verb(s)
            for (const action of actionEntities) {
                const suggested = ACTION_TO_INTENTS[action.category] || [];
                if (suggested.includes(intentName)) {
                    applyModifier(action.idf, `Action verb: "${action.verb}" (+${action.idf.toFixed(2)} IDF)`);
                    matchedKeywords.push(action.verb);
                }
            }
        }

        // 3d. IDF Keyword Match (beyond action verbs): Check intent keywords against text words
        for (const kw of (intent.keywords || [])) {
            if (typeof kw !== 'string') continue;
            const kwLower = kw.toLowerCase();
            const isMultiWord = kwLower.includes(' ');
            const matched = isMultiWord
                ? textLower.includes(kwLower)  // Multi-word: substring match against full text
                : textWords.includes(kwLower); // Single-word: token match
            if (matched && !matchedKeywords.includes(kwLower)) {
                const kwIdf = idfMap[kwLower] || 0.5;
                if (intentName === 'vendor_contact') console.log(`[SchemaResolver] Match for vendor_contact: "${kwLower}" in words: [${textWords.join(', ')}] with IDF ${kwIdf}`);
                // Boost for exact keyword matches (especially for test/debug intents)
                const exactMatch = kwLower === textWords.join(' ').trim();
                const exactMatchBoost = exactMatch ? 3.0 : 0;
                // Multi-word keyword phrases get a higher boost (they are more specific signals)
                const phraseBoost = isMultiWord ? 1.5 : 0;
                applyModifier(kwIdf + exactMatchBoost + phraseBoost, `Keyword match: "${kwLower}"${exactMatch ? ' (Exact match +3.0)' : ''}${isMultiWord ? ' (Phrase +1.5)' : ''}`);
                matchedKeywords.push(kwLower);
            }
        }

        // 3e. Multi-word synonym match (bonus for phrase-level matches)
        for (const syn of (intent.synonyms || [])) {
            if (syn.includes(' ') && text.toLowerCase().includes(syn.toLowerCase())) {
                applyModifier(1.5, `Synonym phrase: "${syn}"`);
                matchedKeywords.push(syn);
            }
        }

        // ── Phase 3f: Intent-Specific Signal Rules ──

        // [Cart Remove Dominance Rule]: if the user explicitly says remove, prioritize remove_from_cart.
        // This prevents false positives where incidental tokens cause product_search to win.
        if (hasCartRemoveAction) {
            if (intentName === 'remove_from_cart') applyModifier(6.0, 'Cart Remove dominance rule');
            if (intentName === 'product_search' || intentName === 'discovery_sentinel' || intentName === 'browse_collection') applyModifier(-4.0, 'Cart Remove suppression rule');
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
                applyModifier(6.0, 'Compare dominance rule');
            }
            if (intentName === 'product_search' || intentName === 'discovery_sentinel') {
                applyModifier(-4.0, 'Compare suppression rule');
            }
        }

        // [Discovery Sentinel Suppression]: discovery_sentinel is a port-only intent.
        // It should never win competition directly.
        if (intentName === 'discovery_sentinel') {
            applyModifier(-15.0, 'Sentinel suppression rule');
        }

        // [Search-Discovery Rule]: If we have a category AND a clause (e.g. "cheap smartphones"),
        // this is a very strong signal for product_search even without an action verb.
        if (intentName === 'product_search') {
            const hasCategory = extractionResult.entities.some(e => e.type === 'category');
            const hasClause = extractionResult.entities.some(e => e.type === 'clause');
            if (hasCategory && hasClause) {
                applyModifier(2.0, 'Category + Clause boost');
            }
        }

        // 3g. Penalty: If intent has required params but entities don't provide ANY relevant type
        // Only penalize if we actually have entities AND no action verb directly points here.
        // When action verbs directly suggest this intent, the missing param will be filled
        // downstream by parameterExtractor or AI — don't penalize the verb's signal.
        const actionDirectlySupports = actionSuggestedIntents.has(intentName);
        if (hasUnfilledRequired && requiredFilled === 0 && entities.length > 0 && !actionDirectlySupports) {
            applyModifier(-5.0, 'No required slots match (unfilled)');
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
            applyModifier(-2.0, 'Baseline penalty (zero-param intent)');
        }

        // 3i. Discovery vs Identity Bias Correction
        if (entityParams['brand'] || entityParams['category']) {
            const categoryQuality = getCategoryQuality() || 1.0;
            if (intentName === 'product_search' || intentName === 'discovery_sentinel') {
                applyModifier(1.5 * categoryQuality, `Discovery boost (Category/Brand)`);
            }
            if (intentName === 'vendor_identity' && !actionSuggestedIntents.has('info')) {
                applyModifier(-2.0, 'Identity penalty (Brand-only mention)');
            }
        }

        // 3j. Hierarchy Boost: Root category alone → boost discovery_sentinel
        // If a root category is mentioned without specific product terms, user wants to browse
        if (entityParams['category'] && isRoot(entityParams['category'].id)) {
            const hasProductTerms = entityParams['product_name'] || entityParams['brand'];
            if (!hasProductTerms && !hasPurchaseAction) {
                if (intentName === 'discovery_sentinel') {
                    applyModifier(2.0, 'Hierarchy boost (Root category)');
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
        // 3k. Facet Dominance Rule
        if (intentName === 'facet_list' && entityParams['facet_target']) {
            const hasDiscoveryMeta = actionEntities.some(e => e.category === 'discovery_meta');
            const hasDiscovery = actionEntities.some(e => e.category === 'discovery');

            if (hasDiscoveryMeta) {
                applyModifier(10.0, 'Facet dominance (Discovery Meta)');
                logDebug('SCORING:FACET_DOMINANCE', {
                    _desc: 'Facet dominance rule — explicit attribute target + discovery verb boosts facet_list',
                    _example: '"what colors..." → facet_list +10',
                    target: entityParams['facet_target'].value,
                    intent: intentName,
                    boost: 10.0
                });
            } else if (hasDiscovery) {
                applyModifier(8.0, 'Facet dominance (Discovery)');
                logDebug('SCORING:FACET_DOMINANCE_SEARCH', {
                    _desc: 'Facet dominance rule — explicit attribute target + search verb boosts facet_list',
                    _example: '"browse colors..." → facet_list +8',
                    target: entityParams['facet_target'].value,
                    intent: intentName,
                    boost: 8.0
                });
            } else {
                applyModifier(2.0, 'Facet boost (Attribute mention)');
            }
        }

        // 3k.2. Vendor Facet Dominance
        // If the query asks "who sells [product]" or "what stores have [product]", prefer vendor_facet over identity
        if (intentName === 'vendor_facet') {
            const hasVendorStorePhrasing = /who sells\b|which store\b|what store\b|which vendor\b|what vendor\b|what seller\b|which seller\b/i.test(text);

            // If the query explicitly asks for a list of vendors/stores
            if (hasVendorStorePhrasing) {
                applyModifier(8.0, 'Vendor Facet phrasing boost');
                logDebug('SCORING:VENDOR_FACET_BOOST', {
                    _desc: 'Vendor Facet rule — phrases asking for sellers/stores boost vendor_facet',
                    _example: '"who sells iphone 12" → vendor_facet +8',
                    intent: intentName,
                    boost: 8.0
                });
            }
        }
        if (intentName === 'vendor_identity') {
            const hasVendorStorePhrasing = /who sells\b|which store\b|what store\b|which vendor\b|what vendor\b|what seller\b|which seller\b/i.test(text);
            // Downweight identity if they are asking for a *list* of who sells it (which is a facet search)
            if (hasVendorStorePhrasing) {
                applyModifier(-5.0, 'Vendor Facet phrases penalty');
            }
        }

        // 3l. Search Interrogative Penalty
        if (intentName === 'product_search' && actionEntities.some(e => e.category === 'discovery_meta')) {
            applyModifier(-5.0, 'Search Interrogative penalty');
        }

        // [New] Orphan Noun Rule: product_search should win over vendor_identity for simple product mentions.
        // BUT: Don't apply this boost if another intent has a direct keyword match (e.g., "dami" → test_microstate)
        // Guardrail: Skip boost if a product was already resolved from context/state.
        if (entityParams['product_name'] && entityParams['product_name'].source === 'residual') {
            const hasResolvedProduct = extractionResult.entities.some(e => e.type === 'resolved_product');
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

            const hasAmbientContext = extractionResult.entities.some(e => e.source === 'AMBIENT_CONTEXT');

            if (intentName === 'product_search') {
                // Only boost if this is NOT a keyword for another intent AND no product is resolved from context
                // GATED: Also skip if we already have AMBIENT_CONTEXT entities (prevents misfires)
                if (!isKeywordForOtherIntent && !residualSupportsOtherIntent && !hasResolvedProduct && !hasAmbientContext) {
                    applyModifier(2.0, 'Orphan Product boost');
                } else if (hasAmbientContext) {
                    logDebug('SCORING:ORPHAN_GATED_BY_AMBIENT', {
                        _desc: 'Orphan Product boost GATED — Ambient Context is already managing this intent',
                        intent: intentName
                    });
                }
            }
            if (intentName === 'vendor_identity') applyModifier(-1.0, 'Orphan Product identity penalty');
        }

        // [Similarity Dominance Rule]: Same pattern as Compare Dominance (3f).
        // When product_similar has keyword matches, suppress product_search to prevent
        // the massive bench bias from drowning out the explicit similarity signal.
        if (nonSearchHitIntents.has('product_similar')) {
            if (intentName === 'product_similar') {
                applyModifier(6.0, 'Similarity Dominance boost');
            }
            if (intentName === 'product_search') {
                applyModifier(-4.0, 'Similarity Dominance suppression');
            }
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
            deterministicBreakdown: breakdown, // Detailed audit
            invertedFrom: null
        });
    }

    // ── Phase 3.5: Signal Density Gating ──
    // Principle: Entity-derived boosts (slot matches, orphan product, discovery boost) should be
    // scaled down when there's no intentional signal (action verbs or keyword matches).
    // High entity count with zero actions/keywords = entity extraction noise, not user intent.
    const signalCount = actionEntities.length + (nonSearchHitIntents.size > 0 ? 1 : 0);
    const entityCount = entities.length;
    // Fix: If there are ZERO entities and ZERO keywords, the density is 0, not 1.0. 
    // Defaulting to 1.0 was letting pure gibberish bypass the low-signal gate.
    const signalDensity = entityCount > 0 ? signalCount / entityCount : 0.0;
    const MIN_SIGNAL_DENSITY = 0.3;
    const isLowSignal = signalDensity < MIN_SIGNAL_DENSITY && signalCount === 0;

    if (isLowSignal) {
        const gatedIntents = [];
        for (const candidate of scored) {
            if (candidate.score > 0) {
                const originalScore = candidate.score;
                candidate.score = candidate.score * 0.5;
                candidate.deterministicBreakdown.push({
                    value: candidate.score - originalScore,
                    reason: `Signal Density Gate: ${signalDensity.toFixed(2)} density (0 actions, 0 keyword hits) → halved`
                });
                gatedIntents.push({
                    intent: candidate.intentName,
                    before: originalScore.toFixed(2),
                    after: candidate.score.toFixed(2),
                    reduction: (originalScore - candidate.score).toFixed(2)
                });
            }
        }

        if (gatedIntents.length > 0) {
            logDebug('SCORING:SIGNAL_DENSITY_GATE', {
                _type: 'SIGNAL_DENSITY',
                _icon: '🚧',
                _color: '#f59e0b',
                _desc: 'Signal Density Gating — entity-derived boosts halved due to zero intentional signal',
                signalDensity: signalDensity.toFixed(2),
                actionCount: actionEntities.length,
                keywordHits: nonSearchHitIntents.size,
                entityCount,
                gatedCount: gatedIntents.length,
                gated: gatedIntents
            });
        }
    }

    // ── Phase 4: Sort and select winner ──
    scored.sort((a, b) => b.score - a.score);

    // Filter to only positive-scoring candidates
    const validCandidates = scored.filter(c => c.score > 0);

    // ── Phase 5: Fallback to semantic discovery (LEGACY - Removed, now handled in index.js) ──
    let fallbackUsed = false;

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
        candidates: validCandidates, // Pass ALL valid candidates to semantic integration
        fallbackUsed,
        extractedEntities: entities,
        residualWords,
        signalDensity: signalCount === 0 ? 0 : signalDensity,
        entityCount
    };
}

module.exports = { resolveIntent, ACTION_TO_INTENTS };
