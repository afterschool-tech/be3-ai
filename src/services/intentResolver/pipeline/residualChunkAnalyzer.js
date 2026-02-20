/**
 * [TEST] Residual Chunk Analyzer
 * Background feature: when residuals are "far apart", use distance + extraction-weight
 * to suggest which chunk should win. Logs only — does not affect main flow.
 *
 * Skip conditions (each logs why):
 * - intent is not product_search/product_compare/add_to_cart
 * - no residuals
 * - positionTracker missing or empty
 * - single residual (no chunks to compare)
 * - single chunk (all residuals consecutive — no "far apart" case)
 */

const { logDebug } = require('../../../utils/debugLogger');

const FAR_APART_THRESHOLD = 2; // words between chunks that count as "real" distance
const ALLOWED_INTENTS = new Set(['product_search', 'product_compare', 'add_to_cart']);

/**
 * Group residual indices into chunks. Do NOT split when the gap between
 * two residuals contains only extracted entities (category, clause, etc.) —
 * those are not "real" gaps.
 * @param {{ wordIndex: number }[]} residuals
 * @param {number[]} entityIndices - flat list of word indices that are extracted entities
 * @returns {number[][]} Array of chunks, each chunk = [idx1, idx2, ...]
 */
function getResidualChunks(residuals, entityIndices = []) {
    if (residuals.length === 0) return [];
    const entitySet = new Set(entityIndices);
    const sorted = [...residuals].sort((a, b) => a.wordIndex - b.wordIndex);
    const chunks = [];
    let current = [sorted[0].wordIndex];
    for (let i = 1; i < sorted.length; i++) {
        const idx = sorted[i].wordIndex;
        const prevIdx = current[current.length - 1];
        const gapIndices = [];
        for (let g = prevIdx + 1; g < idx; g++) gapIndices.push(g);
        const gapIsOnlyEntities = gapIndices.length === 0 || gapIndices.every(g => entitySet.has(g));
        if (gapIsOnlyEntities) {
            current.push(idx);
        } else {
            chunks.push([...current]);
            current = [idx];
        }
    }
    chunks.push(current);
    return chunks;
}

/**
 * Count "true" words between two indices (exclude entity word indices).
 */
function trueDistanceBetween(fromIdx, toIdx, entityIndices) {
    const entitySet = new Set(entityIndices.flat());
    let count = 0;
    for (let i = fromIdx + 1; i < toIdx; i++) {
        if (!entitySet.has(i)) count++;
    }
    return count;
}

/**
 * Extraction weight: how many entities are within 1–2 words of this chunk.
 */
function extractionWeight(chunkIndices, entities) {
    const chunkSet = new Set(chunkIndices);
    const adjacent = new Set();
    for (const idx of chunkIndices) {
        adjacent.add(idx - 2); adjacent.add(idx - 1);
        adjacent.add(idx + 1); adjacent.add(idx + 2);
    }
    let weight = 0;
    for (const e of entities) {
        const indices = e.wordIndices || [];
        if (indices.some(i => chunkSet.has(i) || adjacent.has(i))) weight++;
    }
    return weight;
}

/**
 * Run [TEST] residual chunk analysis. Returns { ran: boolean, reason?: string, result?: object }.
 */
function runResidualChunkAnalysis(options) {
    const {
        intentName,
        productName,
        residualWords,
        positionTracker,
        statementIndex,
        originalText
    } = options;

    // ── Skip conditions ──
    if (!ALLOWED_INTENTS.has(intentName)) {
        logDebug('TEST:RESIDUAL_CHUNK_SKIP', {
            reason: 'intent_not_allowed',
            intentName,
            allowedIntents: Array.from(ALLOWED_INTENTS),
            _desc: '[TEST] Skipped: only runs for product_search, product_compare, or add_to_cart'
        });
        return { ran: false, reason: 'intent_not_allowed', intentName };
    }

    if (!residualWords || residualWords.length === 0) {
        logDebug('TEST:RESIDUAL_CHUNK_SKIP', {
            reason: 'no_residuals',
            intentName,
            _desc: '[TEST] Skipped: no residual words to analyze'
        });
        return { ran: false, reason: 'no_residuals' };
    }

    if (!positionTracker || !positionTracker.residuals || positionTracker.residuals.length === 0) {
        logDebug('TEST:RESIDUAL_CHUNK_SKIP', {
            reason: 'no_position_data',
            intentName,
            residualCount: residualWords.length,
            _desc: '[TEST] Skipped: positionTracker missing or empty residuals'
        });
        return { ran: false, reason: 'no_position_data' };
    }

    if (residualWords.length < 2) {
        logDebug('TEST:RESIDUAL_CHUNK_SKIP', {
            reason: 'single_residual',
            residualWord: residualWords[0],
            _desc: '[TEST] Skipped: only 1 residual word — no chunks to compare'
        });
        return { ran: false, reason: 'single_residual' };
    }

    const entityIndices = (positionTracker.entities || []).map(e => e.wordIndices || []).flat();
    const chunks = getResidualChunks(positionTracker.residuals, entityIndices);
    if (chunks.length < 2) {
        logDebug('TEST:RESIDUAL_CHUNK_SKIP', {
            reason: 'single_chunk',
            residualWords,
            chunkIndices: chunks[0],
            _desc: '[TEST] Skipped: all residuals in one contiguous chunk — no "far apart" case'
        });
        return { ran: false, reason: 'single_chunk' };
    }

    // ── Run analysis ──
    const words = positionTracker.words || [];

    const chunkInfos = chunks.map((indices, ci) => {
        const text = indices.map(i => words[i]).join(' ');
        const weight = extractionWeight(indices, positionTracker.entities || []);
        return { indices, text, weight, chunkIndex: ci };
    });

    // Max true distance between any two consecutive chunks
    let maxTrueDistance = 0;
    for (let c = 0; c < chunks.length - 1; c++) {
        const fromIdx = Math.max(...chunks[c]);
        const toIdx = Math.min(...chunks[c + 1]);
        const d = trueDistanceBetween(fromIdx, toIdx, (positionTracker.entities || []).map(e => e.wordIndices || []));
        maxTrueDistance = Math.max(maxTrueDistance, d);
    }

    const farApart = maxTrueDistance >= FAR_APART_THRESHOLD;

    // Pick winner: highest weight wins. On tie, earliest chunk wins (product name
    // naturally appears before descriptive clauses in natural language).
    let winner = chunkInfos[0];
    let tiebroken = false;
    for (let c = 1; c < chunkInfos.length; c++) {
        const candidate = chunkInfos[c];
        if (candidate.weight > winner.weight) {
            winner = candidate;
            tiebroken = false;
        }
        // On tie: earliest chunk (lowest chunkIndex) stays — no swap needed.
        // If we reach here with equal weight, winner already has lower index.
    }
    if (chunkInfos.filter(c => c.weight === winner.weight).length > 1) {
        tiebroken = true;
    }

    const suggestedProductName = farApart ? winner.text : productName;

    const result = {
        ran: true,
        originalText,
        productNameLumped: productName,
        chunks: chunkInfos,
        maxTrueDistance,
        farApart,
        tiebroken,
        winnerChunk: winner.text,
        suggestedProductName: farApart ? winner.text : null,
        _desc: farApart
            ? `[TEST] Far apart (distance=${maxTrueDistance}). Suggested: "${winner.text}" (weight=${winner.weight}${tiebroken ? ', tiebreak: earliest chunk' : ''})`
            : `[TEST] Chunks close enough (distance=${maxTrueDistance}). No suggestion.`
    };

    logDebug(`TEST:RESIDUAL_CHUNK [Statement ${statementIndex}]`, result);
    return { ran: true, result };
}

module.exports = { runResidualChunkAnalysis, getResidualChunks };
