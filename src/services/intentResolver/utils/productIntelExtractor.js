/**
 * Product Intel Extractor (PIE)
 * A decentralized utility for synthesizing product names from multi-layer pipeline signals.
 * 
 * Logic Phases:
 * 1. MAPPING: Assign "Signal Strength" levels to every word.
 * 2. ANCHORING: Find the "Pivots" (Resolved IDs, Brands, specific nouns).
 * 3. SEGMENTATION: Split comparisons using intel-aware boundaries.
 * 4. RECONSTRUCTION: Expand anchors to recapture category and attribute context.
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
        excludeSet = new Set()
    } = options;

    if (!text) return [];

    const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 0);
    const wordMap = words.map((word, index) => ({
        word,
        index,
        level: LEVELS.TRAIT, // Default
        entities: [],
        isConsumed: false
    }));

    // ── Phase 1: Mapping Intel ──

    // Fillers & Noise
    wordMap.forEach(item => {
        if (excludeSet.has(item.word)) item.level = LEVELS.NOISE;
    });

    // Entity Overlay
    entities.forEach(ent => {
        const fullIndices = ent.wordIndices || [];
        // For categories, we explicitly distinguish between what matched (consumed) and the surrounding window
        const consumedIndices = new Set((ent.type === 'category' && ent.consumedWordIndices) ? ent.consumedWordIndices : fullIndices);

        fullIndices.forEach(idx => {
            if (wordMap[idx]) {
                wordMap[idx].entities.push(ent);

                let newLevel = LEVELS.TRAIT;
                if (consumedIndices.has(idx)) {
                    if (ent.type === 'resolved_product') newLevel = LEVELS.PIVOT;
                    else if (ent.type === 'brand') newLevel = LEVELS.PIVOT;
                    else if (ent.type === 'category') newLevel = LEVELS.CONTEXT;
                    else if (ent.type === 'clause') newLevel = LEVELS.TRAIT;
                    else if (ent.type === 'action') newLevel = LEVELS.NOISE;
                } else {
                    // Associated with an entity but not consumed as the core keyword.
                    newLevel = LEVELS.TRAIT;
                }

                if (ent.type === 'action') newLevel = LEVELS.NOISE;

                // PROTECTION: Entity-associated words should NEVER be NOISE, 
                // UNLESS they are explicitly action verbs.
                if (newLevel > wordMap[idx].level || newLevel === LEVELS.NOISE) {
                    wordMap[idx].level = newLevel;
                }
            }
        });
    });

    // Glue Detection (Heuristic for model numbers/specs)
    wordMap.forEach(item => {
        if (item.level === LEVELS.TRAIT) {
            // Numbers, mixed alphanumeric (e.g. s24, 16, 5g) or very short words (pro, max)
            if (/\d/.test(item.word) || item.word.length <= 3) {
                item.level = LEVELS.GLUE;
            }
        }
    });

    // ── Phase 2: Segmentation ──
    const splits = [0];
    if (intentName === 'product_compare') {
        const splitters = ['vs', 'versus', 'and', 'with', 'between'];
        for (let i = 0; i < wordMap.length; i++) {
            const item = wordMap[i];
            // Split if it's a splitter AND not part of a pivot entity (like "Soap AND Glory")
            if (splitters.includes(item.word)) {
                const isInsidePivot = item.entities.some(e => e.type === 'brand' || e.type === 'resolved_product');
                if (!isInsidePivot) {
                    splits.push(i + 1);
                    item.isConsumed = true; // Mark splitter as consumed
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

    // ── Phase 3: Reconstruction ──
    const products = segments.map(segment => {
        // find pivots or highest level
        const maxLevel = Math.max(...segment.map(s => s.level));
        if (maxLevel === LEVELS.NOISE && segment.length > 0) {
            return null; // All noise
        }

        // Reconstruction Logic: Start from highest signal and expand.
        // We capture PIVOT (4), GLUE (3), and CONTEXT (2).
        // TRAIT (1) words (clauses/attributes) are STRIPPED from the name 
        // to avoid redundant noise in the backend, UNLESS they are part of a PIVOT entity.
        let productIndices = segment
            .filter(s => {
                if (s.level >= LEVELS.CONTEXT) return true;
                if (s.level === LEVELS.TRAIT) {
                    // Keep if explicitly part of a PIVOT entity
                    const isPivot = s.entities.some(e => e.type === 'brand' || e.type === 'resolved_product');
                    if (isPivot) return true;

                    // Drop explicit clauses (e.g. "cheap", "best") unless part of a pivot (handled above)
                    if (s.entities.some(e => e.type === 'clause')) return false;

                    // Otherwise, KEEP IT for now (unknown words, category-associated traits like "drey", "pro")
                    return true;
                }
                return false;
            })
            .map(s => s.index);

        if (productIndices.length === 0) return null;

        // --- PHASE 5: PROXIMITY CLUSTERING & BOUNDARIES ---
        // 1. Identify "Boundary Words" in the full segment
        const boundaries = new Set(['for', 'from', 'my', 'in', 'on', 'at', 'with', 'about']);
        const segmentBoundaryIndices = new Set(
            segment.filter(s => boundaries.has(s.word) && s.level === LEVELS.NOISE).map(s => s.index)
        );

        // 2. Find the "Core Clump" (Highest signal words: PIVOT, GLUE, CONTEXT)
        const coreIndices = segment
            .filter(s => productIndices.includes(s.index) && s.level >= LEVELS.CONTEXT)
            .map(s => s.index);

        if (coreIndices.length > 0) {
            const minCore = Math.min(...coreIndices);
            const maxCore = Math.max(...coreIndices);

            productIndices = productIndices.filter(idx => {
                const s = segment.find(seg => seg.index === idx);
                if (s.level >= LEVELS.CONTEXT) return true; // Always keep core signals

                // It's a TRAIT (Level 1). Check proximity and boundaries.
                // Distance to nearest core part
                const distToCore = idx < minCore ? (minCore - idx) : (idx - maxCore);

                // Rule A: If it's more than 2 words away, drop it. (Too far)
                if (distToCore > 2) return false;

                // Rule B: Check for boundary words between this trait and the core clump
                const searchStart = Math.min(idx, minCore);
                const searchEnd = Math.max(idx, maxCore);
                for (let i = searchStart; i <= searchEnd; i++) {
                    if (segmentBoundaryIndices.has(i)) {
                        return false; // Separated by a boundary word (e.g. "buy phone FOR brother")
                    }
                }

                return true;
            });
        }

        if (productIndices.length === 0) return null;

        // --- SATURATION GUARD ---
        // If the reconstructed name consists ONLY of Context/Category words (Level 2)
        // AND has zero Pivot (4) or Glue (3) signals, we suppress the name.
        // This prevents redundant "iphone" search inside the "iphones" category.
        const hasStrongSignal = segment.some(s => productIndices.includes(s.index) && (s.level >= LEVELS.GLUE));
        if (!hasStrongSignal) {
            const onlyContext = segment.every(s => !productIndices.includes(s.index) || s.level === LEVELS.CONTEXT);
            if (onlyContext) {
                return null;
            }
        }

        const reconstructedName = productIndices.map(idx => wordMap[idx].word).join(' ');

        // Extract associated intel
        const segmentEntities = segment.flatMap(s => s.entities);
        const intel = {
            brand: segmentEntities.find(e => e.type === 'brand')?.value || null,
            category: segmentEntities.find(e => e.type === 'category')?.id || null,
            resolvedId: segmentEntities.find(e => e.type === 'resolved_product')?.productId || null,
            clauses: segmentEntities.filter(e => e.type === 'clause').map(e => e.clauseId)
        };

        return {
            name: reconstructedName,
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
