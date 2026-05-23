/**
 * Hierarchical Transformer Client
 * 
 * Encapsulates all communication with the be3-ai-transformer service.
 * Replaces the inline axios.post calls in the pipeline orchestrator.
 * 
 * Supports:
 *   - L1 (class), L2 (intent), L3 (sub-intent) classification via /classify
 *   - Entity extraction via /extract (unchanged)
 *   - Legacy flat classification via /analyze (backward compat)
 * 
 * Phase 3: micarch
 */

const axios = require('axios');

const TRANSFORMER_URL = process.env.TRANSFORMER_URL || 'http://localhost:3009';
const TIMEOUT_PER_CALL = 5000; // Per-call timeout (ms) — much lower than legacy 10000

/**
 * Classify text at a specific hierarchy level.
 * 
 * @param {string} text - User statement text
 * @param {'class'|'intent'|'subintent'} level - Hierarchy level
 * @param {string|null} parent - Parent context (null for class level)
 * @returns {Object} { level, parent, winner, scores: [{ name, score, bestMatch }] }
 */
async function classify(text, level, parent = null) {
    const body = { text, level };
    if (parent) body.parent = parent;

    const startTime = Date.now();
    const response = await axios.post(`${TRANSFORMER_URL}/classify`, body, { timeout: TIMEOUT_PER_CALL });
    const duration = Date.now() - startTime;

    return {
        level: response.data.level,
        parent: response.data.parent || null,
        winner: response.data.winner,
        scores: response.data.scores || [],
        duration
    };
}

/**
 * Run the full L1 → L2 → L3 classification chain for a single statement.
 * 
 * @param {string} text - User statement text
 * @param {string|null} classHint - IntelliSense class_hint to bypass L1 (optional)
 * @param {Array} entities - Extracted entities for this statement (optional, for deterministic boosting)
 * @returns {Object} Full hierarchical classification result
 */
async function classifyHierarchical(text, classHint = null, entities = []) {
    const result = {
        text,
        class: null,
        intent: null,
        subIntent: null,
        classSkipped: false,
        l1: null,
        l2: null,
        l3: null,
        totalDuration: 0,
        boostApplied: [] // Track which deterministic boosts fired
    };

    const chainStart = Date.now();

    // Helper for entity checking
    const hasEntity = (type) => entities.some(e => e.type === type);

    try {
        // ── L1: CLASS ──
        if (classHint) {
            result.class = classHint;
            result.classSkipped = true;
        } else {
            const l1 = await classify(text, 'class');

            // -- Hierarchical Deterministic Boost --
            if (entities && entities.length > 0) {
                const isOnlyVendor = hasEntity('vendor') && !entities.some(e => ['clause', 'category', 'resolved_product'].includes(e.type));

                if (hasEntity('cart_action') || hasEntity('order_number')) {
                    l1.scores.forEach(s => { if (s.name === 'Shopping_Management') s.score += 5.0; });
                    result.boostApplied.push('L1:Shopping_Management');
                } else if (hasEntity('interaction') && !isOnlyVendor) {
                    // Interaction entities (like "greeting") might boost conversation implicitly
                } else if (isOnlyVendor) {
                    l1.scores.forEach(s => { if (s.name === 'Vendor_Intelligence') s.score += 5.0; });
                    result.boostApplied.push('L1:Vendor_Intelligence');
                }

                if (result.boostApplied.length > 0) {
                    l1.scores.sort((a, b) => b.score - a.score);
                    l1.winner = l1.scores[0]?.name || l1.winner;
                }
            }

            result.class = l1.winner;
            result.l1 = l1;
        }

        if (!result.class) {
            result.totalDuration = Date.now() - chainStart;
            return result;
        }

        // ── L2: INTENT ──
        const l2 = await classify(text, 'intent', result.class);

        // -- Hierarchical Deterministic Boost --
        if (entities && entities.length > 0) {
            if (result.class === 'Shopping_Management') {
                if (hasEntity('order_number')) {
                    l2.scores.forEach(s => { if (s.name === 'Post_Purchase') s.score += 5.0; });
                    result.boostApplied.push('L2:Post_Purchase');
                } else if (hasEntity('cart_action')) {
                    l2.scores.forEach(s => { if (s.name === 'Cart_Management') s.score += 5.0; });
                    result.boostApplied.push('L2:Cart_Management');
                }

                if (result.boostApplied.length > 0) {
                    l2.scores.sort((a, b) => b.score - a.score);
                    l2.winner = l2.scores[0]?.name || l2.winner;
                }
            }
        }

        result.intent = l2.winner;
        result.l2 = l2;

        if (!result.intent) {
            result.totalDuration = Date.now() - chainStart;
            return result;
        }

        // ── L3: SUB-INTENT ──
        const l3 = await classify(text, 'subintent', result.intent);
        result.subIntent = l3.winner;
        result.l3 = l3;

    } catch (err) {
        // Graceful degradation — return whatever levels resolved
        result.error = err.message;
    }

    result.totalDuration = Date.now() - chainStart;
    return result;
}

/**
 * Legacy flat classification — calls /analyze for backward compat.
 * Used when hierarchical pools are unavailable or for A/B comparison.
 * 
 * @param {string[]} texts - Array of statement texts
 * @returns {Object|null} batchedSemanticContext or null on failure
 */
async function analyzeBatch(texts) {
    try {
        const startTime = Date.now();
        const response = await axios.post(`${TRANSFORMER_URL}/analyze`, {
            texts
        }, { timeout: 10000 });
        const duration = Date.now() - startTime;

        if (response.data && Array.isArray(response.data.results)) {
            return {
                results: response.data.results,
                duration,
                available: true
            };
        }
        return null;
    } catch (err) {
        return null;
    }
}

/**
 * Extract entities from text via /extract endpoint.
 * 
 * @param {string} text
 * @returns {Object|null} { entities, confidence } or null on failure
 */
async function extractEntities(text) {
    try {
        const response = await axios.post(`${TRANSFORMER_URL}/extract`, {
            text
        }, { timeout: TIMEOUT_PER_CALL });
        return response.data || null;
    } catch (err) {
        return null;
    }
}

/**
 * Check if the transformer service is reachable.
 * @returns {boolean}
 */
async function isAvailable() {
    try {
        const response = await axios.get(`${TRANSFORMER_URL}/health`, { timeout: 2000 });
        return response.status === 200;
    } catch {
        return false;
    }
}

module.exports = {
    classify,
    classifyHierarchical,
    analyzeBatch,
    extractEntities,
    isAvailable,
    TRANSFORMER_URL
};
