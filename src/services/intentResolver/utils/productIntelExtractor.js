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

    wordMap.forEach(item => {
        if (item.word === ',') {
            item.level = LEVELS.NOISE;
            return;
        }
        if (item.level === LEVELS.TRAIT) {
            if (/\d/.test(item.word) || item.word.length <= 3) {
                item.level = LEVELS.GLUE;
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
            isResolved: !!intel.resolvedId
        };
    }).filter(Boolean);

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
