const path = require('path');
const SemanticMatcher = require('../services/intentResolver/semanticLab/utils/SemanticMatcher');
const { logDebug } = require('./debugLogger');

/**
 * Pure Semantic Resolver (No AI Fallback)
 * Returns clauses based on the mathematical "vibe" of the keyword bench.
 */
let matcher = null;

function getMatcher() {
    if (matcher) return matcher;
    try {
        const BENCH_FILE = path.join(__dirname, '../services/intentResolver/semanticLab/clauses/clause_bench.json');
        matcher = new SemanticMatcher(BENCH_FILE, 'Pure Semantic Clauses');
        return matcher;
    } catch (e) {
        console.error('🔴 [SemanticResolver] CRITICAL: Failed to initialize SemanticMatcher:', e.message);
        matcher = { isLoaded: false, findMatches: () => [] };
        return matcher;
    }
}

/**
 * resolveClauses
 * @param {string} userMessage - The raw user input
 * @param {string} category - The category context
 * @returns {Object} - { clauses: [], display_words: [] }
 */
async function resolveClauses(userMessage, category, conversationHistory = []) {
    const activeMatcher = getMatcher();

    logDebug('CLAUSE_RESOLVER:INPUT', {
        _desc: 'Clause resolver input — resolve semantic clauses (cheap, white, etc.)',
        _example: '"cheap android phones" → cheap, android clauses',
        userMessage,
        category,
        matcherLoaded: activeMatcher.isLoaded
    });

    if (!userMessage || !activeMatcher.isLoaded) {
        logDebug('CLAUSE_RESOLVER:ABORT', {
            _desc: 'Clause resolver abort — empty message or matcher not loaded',
            _example: 'No userMessage → return empty clauses',
            reason: !userMessage ? 'Empty message' : 'Matcher not loaded'
        });
        return { clauses: [], display_words: [] };
    }

    const matches = activeMatcher.findMatches(userMessage);

    logDebug('CLAUSE_RESOLVER:RAW_MATCHES', {
        _desc: 'Clause raw matches — semantic similarity against clause index',
        _example: '"affordable" → cheap clause, similarity 0.85',
        matchCount: matches.length,
        matches: matches.map(m => ({
            id: m.id,
            similarity: m.similarity?.toFixed(3),
            boost: m.boost?.toFixed(3),
            label: m.label
        }))
    });

    const confidentMatches = matches.filter(m => m.similarity > 0.4 || m.boost > 1.8);

    logDebug('CLAUSE_RESOLVER:CONFIDENT_MATCHES', {
        _desc: 'Clause confident matches — filter by similarity > 0.4 or boost > 1.8',
        _example: '3 raw → 2 confident (above threshold)',
        confidentCount: confidentMatches.length,
        clauses: confidentMatches.map(m => m.id),
        thresholds: { similarity: 0.4, boost: 1.8 }
    });

    if (confidentMatches.length === 0) return { clauses: [], display_words: [] };

    return {
        clauses: confidentMatches.map(m => m.id),
        display_words: confidentMatches.map(m => userMessage)
    };
}

module.exports = { resolveClauses };
