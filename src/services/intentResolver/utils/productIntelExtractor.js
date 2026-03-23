/**
 * Product Intel Extractor (PIE)
 * A decentralized utility for synthesizing product names from multi-layer pipeline signals.
 */

const { logDebug } = require('../../../utils/debugLogger');

// Signal Levels
const LEVELS = {
    NOISE: 0,    // Fillers, splitters
    TRAIT: 1,    // Adjectives (blue, large)
    CONTEXT: 2,  // Category words (phone, headset)
    GLUE: 3,     // Model numbers, spec fragments (16, s24, pro)
    PIVOT: 4     // Resolved products or confirmed brands
};

/**
 * Main entry point for PIE analysis.
 */
function extractProductIntel(options) {
    const {
        text,
        entities = [],
        resolutions = [],
        intentName = 'product_search',
        excludeSet = new Set(),
        categoryId = null
    } = options;

    if (!text) return [];

    const normalizedText = text.toLowerCase().replace(/,/g, ' , ');
    const words = normalizedText.split(/\s+/).filter(w => w.length > 0);
    const wordMap = words.map((word, index) => ({
        word,
        index,
        level: LEVELS.TRAIT, // Default
        entities: [],
        isConsumed: false
    }));

    const cleanToRawIndex = {};
    let cleanIdx = 0;
    for (let rawIdx = 0; rawIdx < words.length; rawIdx++) {
        if (words[rawIdx] !== ',') {
            cleanToRawIndex[cleanIdx] = rawIdx;
            cleanIdx++;
        }
    }

    // Phase 1: Mapping
    wordMap.forEach(item => {
        if (excludeSet.has(item.word)) item.level = LEVELS.NOISE;
    });

    entities.forEach(ent => {
        const rawFullIndices = (ent.wordIndices || []).map(i => cleanToRawIndex[i]).filter(i => i !== undefined);
        const rawConsumedSet = new Set(
            ((ent.type === 'category' && ent.consumedWordIndices) ? ent.consumedWordIndices : (ent.wordIndices || []))
                .map(i => cleanToRawIndex[i]).filter(i => i !== undefined)
        );

        rawFullIndices.forEach(idx => {
            if (wordMap[idx]) {
                wordMap[idx].entities.push(ent);

                let newLevel = LEVELS.TRAIT;
                if (rawConsumedSet.has(idx)) {
                    if (ent.type === 'resolved_product') newLevel = LEVELS.PIVOT;
                    else if (ent.type === 'brand') newLevel = LEVELS.PIVOT;
                    else if (ent.type === 'category') newLevel = LEVELS.CONTEXT;
                    else if (ent.type === 'clause') newLevel = LEVELS.TRAIT;
                    else if (ent.type === 'action') newLevel = LEVELS.NOISE;
                }

                if (ent.type === 'action') newLevel = LEVELS.NOISE;
                if (newLevel > wordMap[idx].level || newLevel === LEVELS.NOISE) {
                    wordMap[idx].level = newLevel;
                }
            }
        });
    });

    wordMap.forEach((item, idx) => {
        if (item.word === ',') {
            item.level = LEVELS.NOISE;
            return;
        }
        if (item.level === LEVELS.TRAIT) {
            // ── GLUE LEVEL STRICTNESS ──────────────────────────────────────────
            // Old behaviour: ANY short token (<=3 chars) or token containing a digit
            // was promoted to GLUE. This was too permissive — fragments like "i'd",
            // "ok", "a" survived Phase 3 reconstruction purely because they were short,
            // producing ghost products (e.g. "i'd" from "i'd like to purchase a laptop").
            //
            // New rule: a TRAIT word is only promoted to GLUE if it ALSO meets at
            // least one of the following anchoring conditions:
            //   1. Contains a digit (model numbers, specs: "s24", "16", "a16")
            //   2. Is adjacent (within 1 position) to a PIVOT or CONTEXT word —
            //      meaning it's flanked by a brand/resolved-product/category signal
            //      that gives it real product relevance (e.g. "pro" next to "iphone")
            //
            // Pure short words with no digit and no anchor stay at TRAIT level,
            // where the saturation guard and core-proximity filter can safely drop them.
            const hasDigit = /\d/.test(item.word);
            const isShort = item.word.length <= 3;

            if (hasDigit) {
                // Always GLUE if it contains a digit — model numbers, storage specs, etc.
                item.level = LEVELS.GLUE;
            } else if (isShort) {
                // Short non-digit token: only promote to GLUE if anchored by a
                // PIVOT or CONTEXT neighbour within 1 position in either direction.
                const prev = wordMap[idx - 1];
                const next = wordMap[idx + 1];
                const isAnchored = (prev && prev.level >= LEVELS.CONTEXT) ||
                    (next && next.level >= LEVELS.CONTEXT);
                if (isAnchored) {
                    item.level = LEVELS.GLUE;
                }
                // Otherwise: stays TRAIT — will be dropped unless within 3 words of a core
            }
        }
    });

    // Phase 2: Segmentation
    // Hard Splitters ALWAYS divide products.
    // Soft Splitters (prepositions) divide products ONLY if there are anchors on both sides.
    const hardSplitters = ['vs', 'versus', 'and', 'but', ',', 'between'];
    const softSplitters = ['with', 'for', 'to', 'than', 'like', 'about', 'from', 'at', 'in', 'on', 'of', 'by'];
    const allSplitters = [...hardSplitters, ...softSplitters];

    const splits = [0];
    for (let i = 0; i < wordMap.length; i++) {
        const item = wordMap[i];
        if (allSplitters.includes(item.word)) {
            const isInsidePivot = item.entities.some(e => e.type === 'brand' || e.type === 'resolved_product');
            if (!isInsidePivot) {
                // If it's a soft splitter, we only split if we're in comparison mode 
                // OR if we suspect multiple products (e.g. brand clash)
                let shouldSplit = hardSplitters.includes(item.word);

                if (intentName === 'product_compare') shouldSplit = true;
                if (item.word === 'like') shouldSplit = true; // "phone LIKE iphone"

                if (shouldSplit) {
                    splits.push(i + 1);
                    item.isConsumed = true;
                }
            }
        }
    }
    splits.push(wordMap.length);

    const segments = [];
    for (let i = 0; i < splits.length - 1; i++) {
        const start = splits[i];
        const end = splits[i + 1];
        const slice = wordMap.slice(start, end).filter(item => !item.isConsumed);
        if (slice.length > 0) segments.push(slice);
    }

    // Phase 3: Reconstruction
    const products = segments.map(segment => {
        const maxLevel = Math.max(...segment.map(s => s.level));
        if (maxLevel === LEVELS.NOISE && segment.length > 0) return null;

        let productIndices = segment
            .filter(s => {
                if (s.level >= LEVELS.CONTEXT) return true;
                if (s.level === LEVELS.TRAIT) {
                    const isPivot = s.entities.some(e => e.type === 'brand' || e.type === 'resolved_product');
                    if (isPivot) return true;
                    if (s.entities.some(e => e.type === 'clause')) return false;
                    return true;
                }
                return false;
            })
            .map(s => s.index);

        if (productIndices.length === 0) return null;

        const coreIndices = segment
            .filter(s => productIndices.includes(s.index) && s.level >= LEVELS.CONTEXT)
            .map(s => s.index);

        if (coreIndices.length > 0) {
            const minCore = Math.min(...coreIndices);
            const maxCore = Math.max(...coreIndices);

            productIndices = productIndices.filter(idx => {
                const s = segment.find(seg => seg.index === idx);
                if (s.level >= LEVELS.CONTEXT) return true;

                const distToCore = idx < minCore ? (minCore - idx) : (idx - maxCore);
                // Traits allowed up to 3 words away now to handle fillers
                if (distToCore > 3) return false;
                return true;
            });
        }

        if (productIndices.length === 0) return null;

        const hasStrongSignal = segment.some(s => productIndices.includes(s.index) && (s.level >= LEVELS.GLUE));
        const finalWordSequence = productIndices
            .map(idx => wordMap[idx].word)
            .filter(word => {
                if (word.endsWith("'s") || word.endsWith("s'")) return false;
                return true;
            });

        if (finalWordSequence.length === 0) return null;
        const reconstructedName = finalWordSequence.join(' ');

        // --- SATURATION GUARD ---
        if (!hasStrongSignal) {
            const onlyContext = segment.every(s => !productIndices.includes(s.index) || s.level === LEVELS.CONTEXT);
            if (onlyContext) {
                // REDUNDANCY CHECK: If we have an external category ID AND it matches the reconstructed name
                const resolvedCategory = segment.find(s => s.entities.some(e => e.type === 'category'))?.entities.find(e => e.type === 'category');
                if (resolvedCategory && categoryId && String(resolvedCategory.id) === String(categoryId)) {
                    // It's perfectly redundant (e.g. search "iphones" inside "iphones" category)
                    return null;
                }
            }
        }

        const segmentEntities = segment.flatMap(s => s.entities);
        const intel = {
            brand: segmentEntities.find(e => e.type === 'brand') || null,
            category: segmentEntities.find(e => e.type === 'category') || null,
            resolvedId: segmentEntities.find(e => e.type === 'resolved_product') || null,
            clauses: segmentEntities.filter(e => e.type === 'clause')
        };

        // PIE FORTIFICATION: If the signal is a high-confidence resolved_product, 
        // use its name directly as the reconstructed name (handles LLM re-writes).
        const finalName = (intel.resolvedId?.source === 'INTELLISENSE_OVERRIDE' && intel.resolvedId.value)
            ? intel.resolvedId.value
            : reconstructedName;

        return {
            name: finalName,
            intel,
            confidence: maxLevel / 4,
            isResolved: !!intel.resolvedId,
            // Store the raw word indices this product was reconstructed from.
            // Used by the purchase-verb pre-position guard below to determine
            // whether this product appeared before or after the transaction verb.
            _sourceIndices: productIndices
        };
    }).filter(Boolean);

    // ── PURCHASE VERB PRE-POSITION GUARD ──────────────────────────────────────
    // Problem: PIE can produce spurious "products" from fragments that appear
    // BEFORE a purchase verb in the sentence. E.g. "i'd like to purchase a laptop"
    // segments into ["i'd"] and ["laptop"] — "i'd" survives Phase 3 because it's
    // a short token (GLUE level) with no noise classification.
    //
    // Rule: If the text contains a purchase verb AND multiple products were found,
    // locate the purchase verb's word index and discard any product whose source
    // word indices ALL fall before that position.
    //
    // Edge cases handled:
    //   - No purchase verb → guard is skipped entirely, nothing changes.
    //   - Only one product → guard is skipped (no ambiguity to resolve).
    //   - All products before the verb → guard is skipped to avoid returning
    //     nothing (better to let downstream handle it than discard everything).
    //   - Product spans the verb (e.g. a brand name containing a verb word) →
    //     kept, since at least one of its indices is >= the verb position.
    //
    // Purchase verbs deliberately kept narrow — only true transaction verbs.
    // Broader verbs like "want", "need", "get" intentionally excluded because
    // they frequently appear BEFORE the product ("I want the iPhone") and would
    // incorrectly discard the real product name.
    const PURCHASE_VERBS = new Set(['purchase', 'buy', 'order']);

    if (products.length > 1) {
        // Find the first purchase verb in the wordMap and record its index.
        // We check level === NOISE because action verbs are marked NOISE in Phase 1.
        const purchaseVerbIndex = wordMap.findIndex(
            item => PURCHASE_VERBS.has(item.word) && item.level === LEVELS.NOISE
        );

        if (purchaseVerbIndex !== -1) {
            // Keep only products that have at least one source word at or after the verb
            const afterVerb = products.filter(p =>
                Array.isArray(p._sourceIndices) &&
                p._sourceIndices.some(idx => idx >= purchaseVerbIndex)
            );

            // Only apply the filter if it leaves at least one product standing.
            // If everything is before the verb (unusual edge case), leave the array
            // untouched so downstream can still attempt a search rather than returning nothing.
            if (afterVerb.length > 0 && afterVerb.length < products.length) {
                const discarded = products
                    .filter(p => !afterVerb.includes(p))
                    .map(p => p.name);
                logDebug('PIE:PURCHASE_VERB_GUARD', {
                    purchaseVerb: wordMap[purchaseVerbIndex].word,
                    purchaseVerbIndex,
                    discarded,
                    kept: afterVerb.map(p => p.name)
                });
                products.splice(0, products.length, ...afterVerb);
            }
        }
    }

    // Clean up internal _sourceIndices before returning — callers don't need them
    products.forEach(p => delete p._sourceIndices);

    logDebug('PIE:EXTRACTION', {
        text,
        inputEntities: entities.length,
        outputProducts: products.length,
        products: products.map(p => p.name)
    });

    return products;
}

module.exports = {
    extractProductIntel,
    LEVELS
};
