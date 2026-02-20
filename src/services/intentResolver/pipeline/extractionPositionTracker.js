/**
 * Extraction Position Tracker
 * Shared mutable object that pipeline stages can populate with entity/residual positions.
 * Used for [TEST] residual chunk analysis (distance + weight heuristics).
 */

/**
 * Create a fresh position tracker. Pass to extractEntities; other stages can read it.
 * @returns {Object} { words, entities, residuals }
 */
function createPositionTracker() {
    return {
        words: [],
        entities: [],   // { type, value, wordIndices: number[] }
        residuals: []   // { word: string, wordIndex: number }
    };
}

module.exports = { createPositionTracker };
