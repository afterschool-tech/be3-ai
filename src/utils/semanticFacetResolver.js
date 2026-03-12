const path = require('path');
const SemanticMatcher = require('../services/intentResolver/semanticLab/utils/SemanticMatcher');
const { ATTRIBUTES } = require('../context/storeContext');
const { logDebug } = require('./debugLogger');

/**
 * Semantic Facet Resolver
 * Maps user terminology (e.g., "ROM", "memory") to internal attribute codes (e.g., "storage").
 */

let _matcher = null;
const BENCH_FILE = path.join(__dirname, '../services/intentResolver/semanticLab/facets/facet_bench.json');

function getMatcher() {
    if (_matcher) return _matcher;
    try {
        _matcher = new SemanticMatcher(BENCH_FILE, 'FacetResolver');
        return _matcher;
    } catch (e) {
        console.error('🔴 [FacetResolver] CRITICAL: Failed to initialize SemanticMatcher:', e.message);
        _matcher = { isLoaded: false, findMatches: () => [], benchData: {} };
        return _matcher;
    }
}

/**
 * Resolves a mention of an attribute in text to its internal code.
 * @param {string} text - The words/phrase referring to an attribute
 * @param {Object|null} semanticContext - Transformer context from Stage 0.5
 * @returns {string|null} - The attribute code (e.g., "storage", "color") or null
 */
function resolveFacetAttribute(text, semanticContext = null) {
    if (!text) return null;
    const lower = text.toLowerCase().trim();

    // 1. Semantic Transformer Match (High Priority)
    if (semanticContext?.available && semanticContext.entities?.attribute) {
        for (const [attrCode, matches] of Object.entries(semanticContext.entities.attribute)) {
            const hasMatch = matches.some(m =>
                (m.value || '').toLowerCase() === lower ||
                (m.key || '').toLowerCase() === lower
            );
            if (hasMatch) {
                logDebug('FACET_RESOLVER:TRANSFORMER_HIT', {
                    input: lower,
                    matchedCode: attrCode,
                    source: 'semanticContext'
                });
                return attrCode;
            }
        }
    }

    // 2. Exact Match against internal labels/codes
    for (const [code, attr] of Object.entries(ATTRIBUTES)) {
        if (code === lower || attr.label.toLowerCase() === lower) {
            return code;
        }
    }

    // 3. Semantic Match (TF-IDF Fallback)
    const matcher = getMatcher();
    if (matcher.isLoaded) {
        const matches = matcher.findMatches(lower);
        if (matches.length > 0) {
            const best = matches[0];
            // High threshold for attribute name matching to avoid noise
            if (best.similarity > 0.6 || best.boost > 1.5) {
                logDebug('FACET_RESOLVER:SEMANTIC_HIT', {
                    input: lower,
                    matchedCode: best.id,
                    similarity: best.similarity
                });
                return best.id;
            }
        }
    }

    return null;
}

module.exports = { resolveFacetAttribute };
