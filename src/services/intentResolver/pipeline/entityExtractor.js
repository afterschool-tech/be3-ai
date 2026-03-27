/**
 * Pipeline Stage 4a: Entity Extractor
 * Scans text against known store data to extract typed entities
 * BEFORE intent matching. This is the "what is the user talking about?" layer.
 * 
 * Entity Types:
 *   - vendor:    matched against storeContext.VENDORS
 *   - category:  matched against storeContext.CATEGORIES 
 *   - brand:     pre-detected by Global Pre-pass (Stage 3)
 *   - clause:    pre-detected by Global Pre-pass (Stage 3)
 *   - action:    matched against IDF-weighted keyword index
 *   - order_id:  regex #\d{3,}
 *   - quantity:  regex after action verbs
 *   - price:     regex under/over $X
 * 
 * Imports: normalizeCategory, intentRegistry
 * Returns: { entities: [...], residualWords: [], categoryHints: [], shape: string }
 */

const { normalizeCategory, isOrdinalOrReferencePhrase } = require('../../../utils/normalization');
const { resolveFacetAttribute } = require('../../../utils/semanticFacetResolver');
const { levenshtein } = require('../utils/levenshtein');
const { logDebug } = require('../../../utils/debugLogger');

// ── Action verb patterns (not intent-specific — these are universal action signals) ──
// Each verb maps to a SPECIFIC action category that feeds into ACTION_TO_INTENTS.
// Precision > recall: ambiguous words are excluded to prevent false routing.
const ACTION_VERBS = {
    // Purchase signals (user wants to acquire something)
    'buy': 'purchase', 'purchase': 'purchase', 'grab': 'purchase', 'cop': 'purchase',
    'want': 'purchase', 'need': 'purchase',
    // Cart ADD specifically
    'add': 'cart_add',
    // Cart VIEW specifically
    'cart': 'cart_view', 'basket': 'cart_view', 'bag': 'cart_view',
    // Cart REMOVE specifically
    'remove': 'cart_remove', 'delete': 'cart_remove',
    // Cart UPDATE specifically
    'update': 'cart_update', 'change': 'cart_update', 'bump': 'cart_update',
    'modify': 'cart_update', 'adjust': 'cart_update', 'set': 'cart_update',
    // Discovery actions
    'show': 'discovery', 'find': 'discovery', 'search': 'discovery', 'browse': 'discovery',
    'explore': 'discovery', 'discover': 'discovery', 'look': 'discovery', 'view': 'discovery',
    'products': 'discovery',
    // Contact/communication actions
    'contact': 'contact', 'message': 'contact', 'reach': 'contact', 'talk': 'contact', 'whatsapp': 'contact',
    'email': 'contact', 'call': 'contact',
    // Tracking actions
    'track': 'tracking', 'tracking': 'tracking', 'status': 'tracking',
    // Checkout
    'checkout': 'checkout', 'pay': 'checkout', 'payment': 'checkout',
    // Information
    'about': 'info', 'details': 'info', 'info': 'info', 'information': 'info',
    // Help
    'help': 'help', 'assist': 'help', 'support': 'help', 'guide': 'help',
    // Conversation
    'bye': 'end', 'goodbye': 'end', 'done': 'end',
    // Comparison
    'compare': 'compare', 'versus': 'compare', 'vs': 'compare', 'difference': 'compare',
    // Feedback
    'feedback': 'feedback', 'complaint': 'feedback', 'review': 'feedback', 'rate': 'feedback',
    // Advice
    'recommend': 'advice', 'suggest': 'advice', 'advice': 'advice',
    // Listing
    'list': 'list',
    // Availability
    'available': 'availability', 'stock': 'availability',
    // Confirmation
    'confirm': 'confirm', 'proceed': 'confirm',
    // Cancellation
    'cancel': 'cancel',
    // Delivery
    'delivery': 'delivery', 'shipping': 'delivery', 'deliver': 'delivery',
    // Discovery Meta (Facets)
    'what': 'discovery_meta', 'which': 'discovery_meta', 'available': 'discovery_meta'
    // NOTE: "order", "all", "yes", "thanks" intentionally EXCLUDED — too ambiguous
};

// ── Filler words to skip during entity scanning ──
const FILLERS = new Set([
    'i', 'me', 'my', 'we', 'us', 'you', 'your', 'the', 'a', 'an',
    'is', 'are', 'was', 'were', 'am', 'be', 'been', 'being',
    'to', 'of', 'in', 'for', 'on', 'at', 'by', 'with', 'from',
    'this', 'that', 'these', 'those', 'it', 'its',
    'do', 'does', 'did', 'doing',
    'have', 'has', 'had', 'having',
    'will', 'would', 'shall', 'should', 'may', 'might', 'can', 'could',
    'not', 'no', 'nor', 'so', 'if', 'or', 'and', 'also',
    'what', 'which', 'who', 'whom', 'how', 'when', 'where', 'why',
    'some', 'any', 'many', 'much', 'more', 'most', 'other',
    'just', 'also', 'very', 'really', 'please', 'pls', 'plz',
    'ok', 'okay', 'yo', 'sup',
    'yeah', 'yes', 'yep', 'yup', 'nope', 'nah',
    'thanks', 'thank', 'thx', 'ty', 'cool', 'great', 'sure',
    'let',
    'show', 'find', 'get', 'give', 'tell', 'look', 'looking', 'see', 'about',
    "i'm", "i'd", "i'll", "i've", "let's", "don't", "doesn't",
    "can't", "won't", "shouldn't", "wouldn't", "couldn't"
]);

/**
 * Extract all recognizable entities from text.
 * 
 * @param {string} text - Cleaned, lowercased text (after fuzzy + context resolution)
 * @param {Object} storeContext - Store context with VENDORS, CATEGORIES, ATTRIBUTES
 * @param {Object} idfMap - IDF weights for keywords (from intentRegistry.buildIdfMap())
 * @param {Object} [positionTracker] - Optional. If provided, populated with { words, entities, residuals } for [TEST] analysis.
 * @param {Array} resolutions - Context-resolved product tokens
 * @param {Array} preDetectedEntities - Entities from the Global Pre-pass (Stage 3)
 * @param {Array} categoryHints - Category hints from the Global Pre-pass
 * @param {Object|null} semanticContext - Transformer context from Stage 0.5 (null if transformer unavailable)
 * @returns {Object} { entities: Array, residualWords: Array, categoryHints: Array, shape: string }
 */
function extractEntities(text, storeContext = {}, idfMap = {}, positionTracker = null, resolutions = [], preDetectedEntities = [], categoryHints = [], semanticContext = null) {
    const entities = [];
    const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 0);
    const consumed = new Set(); // Track consumed word indices

    // ── Stage 0: Token Mask Consumption ──
    // Immediately consume collapsed product tokens injected by contextResolver.
    // These are single contiguous tokens like "iphone16pro" that represent resolved
    // product names. By marking them consumed NOW, no downstream stage
    // (normalizeCategory, action verbs, brands) can touch them.
    if (resolutions && resolutions.length > 0) {
        for (const res of resolutions) {
            if (!res.collapsed) continue;
            const collapsedLower = res.collapsed.toLowerCase();
            for (let i = 0; i < words.length; i++) {
                if (consumed.has(i)) continue;
                if (words[i] === collapsedLower) {
                    entities.push({
                        type: 'resolved_product',
                        value: res.resolved,       // Original human-readable name
                        collapsed: res.collapsed,   // The masked token in the text
                        productId: res.productId,
                        source: 'context_resolution',
                        wordIndices: [i]
                    });
                    consumed.add(i);
                    console.log(`[EntityExtractor] 🛡️ Mask consumed: "${words[i]}" → resolved product "${res.resolved}"`);
                    logDebug('ENTITY:MASK_CONSUMED', {
                        _desc: 'Token mask consumed — collapsed product token marked as consumed, blocked from normalizeCategory',
                        _example: '"iphone16pro" consumed at word[2] → resolved_product entity (iPhone 16 Pro)',
                        collapsedToken: words[i],
                        originalName: res.resolved,
                        productId: res.productId,
                        wordIndex: i
                    });
                }
            }
        }
    }

    if (resolutions && resolutions.length > 0) {
        const maskedCount = entities.filter(e => e.type === 'resolved_product').length;
        logDebug('ENTITY:STAGE0_MASK_SUMMARY', {
            _desc: 'Stage 0 mask consumption summary — total context-resolved products protected from downstream extraction',
            _example: '2 resolutions in, 2 resolved_product entities emitted, 2 words consumed',
            resolutionCount: resolutions.length,
            maskedCount: maskedCount,
            maskedTokens: entities.filter(e => e.type === 'resolved_product').map(e => ({
                collapsed: e.collapsed,
                original: e.value
            }))
        });
    }

    // ── Stage 0b: Pre-detected Entity Ingestion (from Global Pre-pass) ──
    // Clauses and brands were already detected globally in Stage 3.
    // We ingest them here and mark their word indices as consumed
    // BEFORE the Category N-gram scanner runs, guaranteeing shielding.
    if (preDetectedEntities && preDetectedEntities.length > 0) {
        for (const preEnt of preDetectedEntities) {
            // ── Phantom Entity Fast Path ──
            // Entities from Ambient Context have no position in the text.
            // Ingest them directly without trying to compute or consume word indices.
            if (preEnt.source === 'AMBIENT_CONTEXT') {
                entities.push({
                    type: preEnt.type,
                    value: preEnt.value,
                    categoryId: preEnt.categoryId,
                    productId: preEnt.productId,
                    attributeCode: preEnt.attributeCode,
                    source: preEnt.source,
                    wordIndices: [] // Phantom
                });
                continue;
            }

            // Support both globalWordIndex (from Stage 3 pre-pass) and localWordIndex (from Stage 3d reconciliation)
            let localIdx = preEnt.localWordIndex;
            if (localIdx === undefined) localIdx = preEnt.globalWordIndex;

            // Prefer explicit wordIndices when available (e.g. from IntelliSense multi-word products);
            // fall back to localIdx + wordCount synthesis for pre-pass entities.
            let indices;
            if (Array.isArray(preEnt.wordIndices) && preEnt.wordIndices.length > 0) {
                indices = preEnt.wordIndices.filter(idx => idx >= 0 && idx < words.length);
            } else {
                const wordCount = preEnt.wordCount || 1;
                if (localIdx === undefined || localIdx < 0 || localIdx >= words.length) continue;
                indices = Array.from({ length: Math.min(wordCount, words.length - localIdx) }, (_, i) => localIdx + i);
            }
            if (indices.length === 0) continue;
            if (localIdx === undefined) localIdx = Math.min(...indices);

            // Only skip if the VERY FIRST word is already consumed
            if (consumed.has(localIdx)) {
                // For resolved_product: even if entity is skipped, shield ALL its word indices
                // from the category scanner. We don't want product words leaking into N-gram scan.
                if (preEnt.type === 'resolved_product') {
                    indices.forEach(idx => consumed.add(idx));
                }
                continue;
            }

            entities.push({
                type: preEnt.type,
                value: preEnt.value,
                clauseId: preEnt.clauseId,
                clauseLabel: preEnt.clauseLabel,
                attribute: preEnt.attribute,
                source: preEnt.source,
                similarity: preEnt.similarity,
                wordIndices: indices
            });
            indices.forEach(idx => consumed.add(idx));
        }

        logDebug('ENTITY:PREPASS_INGESTED', {
            _desc: 'Pre-detected entities ingested from Global Pre-pass — shielded from Category Scanner',
            _example: '"cheap" (clause) and "infinix" (brand) consumed at Stage 0b before category N-gram',
            count: preDetectedEntities.length,
            ingested: preDetectedEntities.map(e => ({
                type: e.type,
                value: e.value,
                clauseId: e.clauseId,
                localIdx: e.localWordIndex !== undefined ? e.localWordIndex : e.globalWordIndex
            }))
        });
    }

    // ── 0c. Semantic Attribute Hints (Transformer) — NON-CONSUMING ──
    // Emit transformer-detected attributes as advisory hints.
    // CRITICAL: We do NOT consume word indices here. Consuming would block
    // facet target detection (Stage 2c) for words like "storage", "colors", etc.
    // These hints are ingested later in parameterExtractor with intent-aware gating.
    if (semanticContext?.available && semanticContext.entities?.attribute) {
        for (const [attrType, attrValues] of Object.entries(semanticContext.entities.attribute)) {
            // Skip if brand already detected as entity (brand is first-class)
            if (attrType === 'brand' && entities.some(e => e.type === 'brand')) continue;
            // Skip if this attribute type already detected via clauses (first-class citizens)
            const alreadyDetected = entities.some(e =>
                e.type === 'clause' && e.attribute === attrType
            );
            if (alreadyDetected) continue;

            for (const attrValue of attrValues) {
                const attrValueLower = attrValue.toLowerCase();
                const wordIdx = words.findIndex(w => w === attrValueLower);

                entities.push({
                    type: 'transformer_attribute_hint',
                    subType: attrType,
                    value: attrValue,
                    source: 'TRANSFORMER_SEMANTIC',
                    advisory: true,  // Explicitly non-consuming
                    wordIndices: wordIdx !== -1 ? [wordIdx] : []
                });
                // NOTE: No consumed.add() — words stay free for facet detection

                logDebug('ENTITY:SEMANTIC_ATTRIBUTE_HINT', {
                    _desc: 'Transformer attribute hint — advisory only, word NOT consumed',
                    attribute: attrType,
                    value: attrValue,
                    wordIndex: wordIdx
                });
            }
        }
    }


    // ── 1. Vendor Detection (N-gram, longest match first) ──
    if (storeContext.VENDORS) {
        const vendorNames = [];
        for (const v of Object.values(storeContext.VENDORS)) {
            vendorNames.push({
                name: v.business_name.toLowerCase(),
                id: v.id,
                tag: v.tag,
                original: v.business_name
            });
        }

        // Try 4-gram down to 1-gram
        for (let size = 4; size >= 1; size--) {
            for (let i = 0; i <= words.length - size; i++) {
                if (consumed.has(i)) continue;
                const phrase = words.slice(i, i + size).join(' ');

                // Exact match
                let match = vendorNames.find(v => v.name === phrase || v.tag?.toLowerCase() === phrase);

                // Fuzzy match (Levenshtein distance ≤ 2 for names > 4 chars)
                if (!match && phrase.length > 4) {
                    match = vendorNames.find(v => {
                        const dist = levenshtein(phrase, v.name);
                        return dist <= 2 && dist < phrase.length * 0.4;
                    });
                }

                if (match) {
                    entities.push({
                        type: 'vendor',
                        value: match.original,
                        id: match.id,
                        source: 'storeContext.VENDORS',
                        wordIndices: Array.from({ length: size }, (_, j) => i + j)
                    });
                    for (let j = i; j < i + size; j++) consumed.add(j);
                    break; // Only one vendor per query
                }
            }
            if (entities.some(e => e.type === 'vendor')) break;
        }

        // --- 1b. Semantic Vendor Integration (Transformer Discovery) ---
        if (!entities.some(e => e.type === 'vendor') && semanticContext?.available && semanticContext.entities?.vendor) {
            const semVendors = semanticContext.entities.vendor;
            for (const semVendorKey of semVendors) {
                // Find vendor by ID or slug/key matching business_name
                const vendorObj = Object.values(storeContext.VENDORS).find(v =>
                    v.id === semVendorKey || v.business_name.toLowerCase() === semVendorKey?.toLowerCase()
                );

                if (vendorObj) {
                    const confKey = `vendor:${semVendorKey}`;
                    const conf = semanticContext.confidence?.[confKey] || 0.85;

                    entities.push({
                        type: 'vendor',
                        value: vendorObj.business_name,
                        id: vendorObj.id,
                        source: 'TRANSFORMER_SEMANTIC',
                        confidence: conf,
                        wordIndices: [-1] // Global/semantic only
                    });

                    logDebug('ENTITY:SEMANTIC_VENDOR_INJECT', {
                        _desc: 'Transformer discovered vendor not found by deterministic N-gram — injected',
                        vendor: vendorObj.business_name,
                        id: vendorObj.id,
                        confidence: conf.toFixed(3)
                    });
                    break;
                }
            }
        }
    }

    // ── 2. Action Verb Detection (with IDF weights) ──
    for (let i = 0; i < words.length; i++) {
        if (consumed.has(i)) continue;
        const word = words[i];
        if (FILLERS.has(word)) continue;

        const actionCategory = ACTION_VERBS[word];
        if (actionCategory) {
            entities.push({
                type: 'action',
                verb: word,
                category: actionCategory,
                idf: idfMap[word] || 1.0,
                source: 'ACTION_VERBS',
                wordIndices: [i]
            });
            consumed.add(i);
        }

        // ── 2c. Facet Target Detection (Semantic Resolver) ──
        // Try to resolve ANY word that isn't already consumed (except fillers) as a facet target
        // if it's near a discovery or discovery_meta verb or looks like an attribute name.
        const prevWordAction = i > 0 ? ACTION_VERBS[words[i - 1]] : null;
        const actionCat = actionCategory || '';
        const prevCat = prevWordAction || '';
        const isNearDiscovery = actionCat.includes('discovery') || prevCat.includes('discovery');

        if (isNearDiscovery || ['colors', 'brands', 'storage', 'materials', 'sizes', 'qualities'].includes(word)) {
            const resolvedAttr = resolveFacetAttribute(word, semanticContext);
            if (resolvedAttr) {
                entities.push({
                    type: 'facet_target',
                    value: word,
                    attribute: resolvedAttr,
                    source: 'semanticFacetResolver',
                    wordIndices: [i]
                });

                // CRITICAL: Consume the word so it doesn't accidentally trigger a category 
                // match (e.g. "storage" triggering the "ram_&_storage" category)
                consumed.add(i);
            }
        }
    }

    // ── 3. Category Detection (N-gram, reuses normalizeCategory) ──
    if (storeContext.CATEGORIES) {
        const textLower = text.toLowerCase();
        // Build word position map for accurate context detection
        let currentPos = 0;
        const wordPositions = words.map(w => {
            const pos = textLower.indexOf(w, currentPos);
            currentPos = pos >= 0 ? pos + w.length : currentPos;
            return pos;
        });

        let bestCandidate = null;
        const tierRejects = []; // Track candidates that had higher scores but lost due to lower tier

        for (let size = 3; size >= 1; size--) {
            for (let i = 0; i <= words.length - size; i++) {
                let overlaps = false;
                for (let j = i; j < i + size; j++) {
                    if (consumed.has(j)) {
                        overlaps = true;
                        break;
                    }
                }
                if (overlaps) continue;

                const phraseWords = words.slice(i, i + size);
                if (phraseWords.every(w => FILLERS.has(w))) continue;
                if (FILLERS.has(phraseWords[0]) || FILLERS.has(phraseWords[phraseWords.length - 1])) continue;

                const phrase = phraseWords.join(' ');
                const phraseStartIndex = wordPositions[i] >= 0 ? wordPositions[i] : -1;
                if (isOrdinalOrReferencePhrase(phrase, textLower, phraseStartIndex)) continue;

                const catRes = normalizeCategory(phrase, storeContext.CATEGORIES, false, { debug: false, topK: 5, returnMeta: true, initiator: 'entityExtractor', semanticContext, categoryHints });
                const catId = catRes && typeof catRes === 'object' ? catRes.id : catRes;
                const catMeta = catRes && typeof catRes === 'object' ? (catRes.meta || null) : null;

                if (catId) {
                    // --- Winner Selection Logic (Full Scan) ---
                    // Instead of immediate break, we track the best candidate across the full sentence.
                    const currentScore = catMeta?.score || 0;
                    const currentTier = Number(catMeta?.lexTier || 0);

                    const isBetter = !bestCandidate || 
                        currentTier > bestCandidate.tier || 
                        (currentTier === bestCandidate.tier && currentScore > bestCandidate.score) ||
                        (currentTier === bestCandidate.tier && currentScore === bestCandidate.score && size > bestCandidate.size);

                    if (isBetter) {
                        // Track if the old best had a higher score but lost to tier
                        if (bestCandidate && currentTier > bestCandidate.tier && currentScore < bestCandidate.score) {
                            tierRejects.push({
                                phrase: bestCandidate.phrase,
                                catId: bestCandidate.catId,
                                score: bestCandidate.score,
                                tier: bestCandidate.tier,
                                lostTo: { phrase, tier: currentTier, score: currentScore }
                            });
                        }
                        bestCandidate = { 
                            catId, 
                            catMeta, 
                            phrase, 
                            size,
                            tier: currentTier, 
                            score: currentScore,
                            matchedWordIndices: Array.from({ length: size }, (_, j) => i + j) 
                        };
                    } else if (bestCandidate && currentScore > bestCandidate.score && currentTier < bestCandidate.tier) {
                        // Current candidate has higher score but lost due to lower tier
                        tierRejects.push({
                            phrase,
                            catId,
                            score: currentScore,
                            tier: currentTier,
                            lostTo: { phrase: bestCandidate.phrase, tier: bestCandidate.tier, score: bestCandidate.score }
                        });
                    }
                }
            }
        }

        // If we found a winner after the full scan, commit it
        if (bestCandidate) {
            const { catId, catMeta, phrase, tier, matchedWordIndices } = bestCandidate;

            // Merge intra-phrase tier rejects bubbled up from normalizeCategory
            if (catMeta && Array.isArray(catMeta._tierRejects)) {
                for (const r of catMeta._tierRejects) {
                    tierRejects.push(r);
                }
            }

            let categoryQuality = 1.0;
            if (catMeta && catMeta.layer === 'layer2') {
                if (tier >= 4) categoryQuality = 0.35;
                else if (tier === 3) categoryQuality = 0.25;
                else if (tier === 2) categoryQuality = 0.10;
                else categoryQuality = 0.10;
            }

            // ACCOUNTABILITY: Only consume words that normalizeCategory explicitly highlights as "used"
            let consumedWordIndices = [];
            if (catMeta && Array.isArray(catMeta.usedWords)) {
                const usedWordsSet = new Set(catMeta.usedWords.map(w => w.toLowerCase()));
                consumedWordIndices = matchedWordIndices.filter(idx => {
                    const word = words[idx].toLowerCase();
                    const subTokens = word.split(/[\s\-_\/]+/g).filter(Boolean);
                    return subTokens.some(st => usedWordsSet.has(st));
                });
            }

            entities.push({
                type: 'category',
                value: phrase,
                id: catId,
                source: 'storeContext.CATEGORIES',
                matchMeta: catMeta,
                quality: categoryQuality,
                wordIndices: matchedWordIndices,
                consumedWordIndices,
                _tierRejects: tierRejects.length > 0 ? tierRejects : undefined
            });

            for (const idx of consumedWordIndices) {
                consumed.add(idx);
            }

            logDebug('ENTITY:WINNER_SELECTION', {
                _desc: 'Category scan complete — highest scoring candidate selected from full phrase',
                winner: phrase,
                id: catId,
                tier,
                score: bestCandidate.score.toFixed(2),
                lexScore: catMeta?.lexScore || 0
            });

            // ── Winner Detail Trace ──
            // Re-run the winner through normalizeCategory with debug: true
            // to populate the logs with its specific breakdown without n-gram spam.
            normalizeCategory(phrase, storeContext.CATEGORIES, false, { debug: true, initiator: 'entityExtractor_winner_trace', semanticContext, categoryHints });
        }


        // ── 3b. Semantic Category Kickstart ──
        // When determinism had zero free words to scan (all consumed by prepass/IntelliSense),
        // semantic takes over entirely. The transformer's top category slug is resolved
        // directly from storeContext.CATEGORIES — no normalizeCategory needed since
        // determinism can't contribute anyway.
        if (!entities.some(e => e.type === 'category') && semanticContext?.available && semanticContext.entities?.category?.length > 0) {
            const hasUnconsumedNonFiller = words.some((w, i) => !consumed.has(i) && !FILLERS.has(w) && w.length > 1);

            if (!hasUnconsumedNonFiller) {
                const semCategories = semanticContext.entities.category
                    .map(slug => ({ slug, confidence: semanticContext.confidence?.[`category:${slug}`] || 0 }))
                    .sort((a, b) => b.confidence - a.confidence);

                const topSlug = semCategories[0]?.slug;
                if (topSlug) {
                    // Direct lookup — find category by key, slug, or label
                    const catEntry = Object.entries(storeContext.CATEGORIES).find(([key, c]) =>
                        key === topSlug || c.slug === topSlug || c.label?.toLowerCase() === topSlug
                    );

                    if (catEntry) {
                        const [, cat] = catEntry;
                        entities.push({
                            type: 'category',
                            value: topSlug,
                            id: cat.id,
                            source: 'SEMANTIC_KICKSTART',
                            quality: 0.35,
                            wordIndices: [-1],
                            consumedWordIndices: []
                        });

                        logDebug('ENTITY:SEMANTIC_CATEGORY_KICKSTART', {
                            _desc: 'Semantic kickstart — determinism had no free words, transformer directly resolved category',
                            slug: topSlug,
                            confidence: semCategories[0].confidence,
                            resolvedId: cat.id,
                            resolvedLabel: cat.label
                        });
                    }
                }
            }
        }

        // ── 2b. Vendor-Category Prioritization ──
        // If vendor detected AND vendor has a categories list, bias toward those categories
        const detectedVendor = entities.find(e => e.type === 'vendor');
        if (detectedVendor && storeContext.VENDORS) {
            const vendorObj = Object.values(storeContext.VENDORS).find(v => v.id === detectedVendor.id);
            const vendorCats = vendorObj?.categories || [];
            if (vendorCats.length > 0) {
                const detectedCat = entities.find(e => e.type === 'category');
                if (!detectedCat) {
                    // No category detected yet — try to infer from vendor's categories
                    const firstCat = Object.values(storeContext.CATEGORIES).find(c => vendorCats.includes(c.id));
                    if (firstCat) {
                        logDebug('ENTITY:VENDOR_CAT_INFER', {
                            _desc: 'Entity vendor-category inference — infer category from vendor',
                            _example: 'Dareymi vendor → inferred category from vendor list',
                            vendor: vendorObj.business_name,
                            inferred: firstCat.label,
                            reason: 'No category detected, using vendor category list'
                        });
                        // Don't auto-inject — just log for now. The vendor's presence is enough context.
                    }
                }
            }
        }
    }

    // ── 4. Regex Detections (Order ID, Price, Quantity) ──
    // These remain in entityExtractor as they are simple regex patterns.
    const orderMatch = text.match(/(?:#|order\s*[-#]?|ord[-#])\s*(\d{3,})/i);
    if (orderMatch) {
        entities.push({
            type: 'order_id',
            value: orderMatch[1],
            source: 'regex',
            wordIndices: []
        });
    }

    const priceMaxMatch = text.match(/(?:under|below|less than|max|cheaper than|budget)\s*\$?\s*(\d+(?:\.\d{1,2})?)/i);
    if (priceMaxMatch) {
        entities.push({
            type: 'price_max',
            value: parseFloat(priceMaxMatch[1]),
            source: 'regex',
            wordIndices: []
        });
    }
    const priceMinMatch = text.match(/(?:over|above|more than|min|at least)\s*\$?\s*(\d+(?:\.\d{1,2})?)/i);
    if (priceMinMatch) {
        entities.push({
            type: 'price_min',
            value: parseFloat(priceMinMatch[1]),
            source: 'regex',
            wordIndices: []
        });
    }

    const qtyMatch = text.match(/\b(?:add|buy|get|order|want|need|grab|purchase)\s+(\d+)\b/i);
    if (qtyMatch) {
        const qty = parseInt(qtyMatch[1]);
        if (qty > 0 && qty <= 100) {
            entities.push({
                type: 'quantity',
                value: qty,
                source: 'regex',
                wordIndices: []
            });
        }
    }

    // ── 5. Residual Words (unconsumed, non-filler = potential product names) ──
    const residualWords = [];
    const residualWithIndices = [];
    for (let i = 0; i < words.length; i++) {
        if (!consumed.has(i) && !FILLERS.has(words[i]) && words[i].length > 1) {
            residualWords.push(words[i]);
            residualWithIndices.push({ word: words[i], wordIndex: i });
        }
    }

    // ── 6. Dynamic Shape Synthesis ──
    // Build the "shape" of the statement by replacing detected entity indices
    // with [type] placeholders. Unconsumed non-filler words become [residual].
    const shapeWords = words.map((w, i) => {
        if (FILLERS.has(w)) return null; // Skip fillers in shape
        const entity = entities.find(e => e.wordIndices && e.wordIndices.includes(i));
        if (entity) {
            const type = entity.type === 'resolved_product' ? 'product' : entity.type;
            return `[${type}]`;
        }
        if (!consumed.has(i) && w.length > 1) return '[residual]';
        return null;
    }).filter(Boolean);

    // Deduplicate consecutive identical placeholders (e.g., [residual] [residual] → [residual])
    const shape = shapeWords.reduce((acc, curr) => {
        if (acc.length === 0 || acc[acc.length - 1] !== curr) acc.push(curr);
        return acc;
    }, []).join(' ');

    logDebug('ENTITY:SHAPE', {
        _desc: 'Dynamic shape synthesis — statement structure with entity placeholders',
        _example: '"show me cheap phones" → "[action] [clause] [category]"',
        shape,
        words,
        consumed: Array.from(consumed)
    });

    if (positionTracker && typeof positionTracker === 'object') {
        positionTracker.words = [...words];
        positionTracker.entities = entities.map(e => ({
            type: e.type,
            value: e.value || e.verb,
            wordIndices: e.wordIndices || []
        }));
        positionTracker.residuals = [...residualWithIndices];
    }

    return { entities, residualWords, categoryHints, shape };
}

module.exports = { extractEntities, ACTION_VERBS };
