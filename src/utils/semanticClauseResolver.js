const path = require('path');
const SemanticMatcher = require('../services/intentResolver/semanticLab/utils/SemanticMatcher');
const { CLAUSES } = require('../context/clauses');
const { logDebug } = require('./debugLogger');

/**
 * Global Semantic Pre-pass (Stage 3)
 * Runs ONCE per query (before statement splitting) to identify all
 * clauses and brands across the entire user message.
 * 
 * Returns pre-detected entities with global word indices so they can
 * be "shielded" from the Category Scanner in each statement.
 */

// ── Build deterministic lookups from CLAUSES config ──
const CLAUSE_LOOKUP = new Map();
const BRAND_LOOKUP = new Map();
const CLAUSE_EXCLUDE = new Set(['by', 'for', 'the', 'a', 'and', 'of', 'in', 'men', 'ladies',
    'high', 'small', 'color', 'all', 'yes', 'no', 'ok', 'new']);

for (const [clauseId, clause] of Object.entries(CLAUSES)) {
    if (clause.attribute === 'brand') {
        const label = clause.label.toLowerCase();
        BRAND_LOOKUP.set(label, { clauseId, label: clause.label, attribute: 'brand', categories: clause.categories || [] });
        (clause.matches || []).forEach(m => {
            BRAND_LOOKUP.set(m.toLowerCase(), { clauseId, label: clause.label, attribute: 'brand', categories: clause.categories || [] });
        });
    } else {
        const allWords = [clause.label, ...(clause.matches || [])];
        if (clause.display?.prefix) allWords.push(clause.display.prefix);
        if (clause.display?.suffix) allWords.push(clause.display.suffix);

        for (const word of allWords) {
            const w = word.toLowerCase().trim();
            if (w.length > 1 && !CLAUSE_EXCLUDE.has(w)) {
                CLAUSE_LOOKUP.set(w, {
                    clauseId,
                    label: clause.label,
                    attribute: clause.attribute,
                    word: w,
                    categories: clause.categories || []
                });
            }
        }
    }
}

// ── Lazy-init semantic matcher ──
let _matcher = null;
function getMatcher() {
    if (_matcher) return _matcher;
    try {
        const BENCH_FILE = path.join(__dirname, '../services/intentResolver/semanticLab/clauses/clause_bench.json');
        _matcher = new SemanticMatcher(BENCH_FILE, 'GlobalPrepass');
        return _matcher;
    } catch (e) {
        console.error('🔴 [SemanticPrepass] CRITICAL: Failed to initialize SemanticMatcher:', e.message);
        _matcher = { isLoaded: false, findMatches: () => [], benchData: {} };
        return _matcher;
    }
}

// ── Filler words to skip ──
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
    'ok', 'okay', 'hi', 'hello', 'hey', 'yo', 'sup',
    'yeah', 'yes', 'yep', 'yup', 'nope', 'nah',
    'thanks', 'thank', 'thx', 'ty', 'cool', 'great', 'sure',
    'let',
    'show', 'find', 'get', 'give', 'tell', 'look', 'looking', 'see', 'about',
    "i'm", "i'd", "i'll", "i've", "let's", "don't", "doesn't",
    "can't", "won't", "shouldn't", "wouldn't", "couldn't"
]);

/**
 * resolveClausesGlobal
 * Runs a FULL query-wide scan for clauses and brands.
 *
 * @param {string} text - The full cleaned user message (post-fuzzy, post-context resolution)
 * @param {Array} resolutions - Resolved product tokens from contextResolver (to skip masked words)
 * @returns {Object} { globalEntities: [...], categoryHints: string[] }
 *   Each entity: { type, value, clauseId, clauseLabel, attribute, source, globalWordIndex }
 */
function resolveClausesGlobal(text, resolutions = []) {
    const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 0);
    const globalEntities = [];
    const consumed = new Set();

    // ── Step 0: Mark masked product tokens as consumed ──
    if (resolutions && resolutions.length > 0) {
        for (const res of resolutions) {
            if (!res.collapsed) continue;
            const collapsedLower = res.collapsed.toLowerCase();
            for (let i = 0; i < words.length; i++) {
                if (words[i] === collapsedLower) {
                    consumed.add(i);
                }
            }
        }
    }

    logDebug('PREPASS:INPUT', {
        _desc: 'Global Pre-pass input — full query scanned for clauses/brands before statement splitting',
        _example: '"show me cheap infinixhot30i smartph" → scan for clauses/brands across all words',
        words: words.filter((w, i) => !consumed.has(i)),
        maskedCount: consumed.size,
        totalWords: words.length
    });

    // ── Step 1: Deterministic Pass (exact matches from CLAUSE_LOOKUP + BRAND_LOOKUP) ──
    for (let i = 0; i < words.length; i++) {
        if (consumed.has(i) || FILLERS.has(words[i])) continue;

        // Check brands first (higher priority)
        const brandMatch = BRAND_LOOKUP.get(words[i]);
        if (brandMatch) {
            globalEntities.push({
                type: 'brand',
                value: brandMatch.label,
                clauseId: brandMatch.clauseId,
                clauseLabel: brandMatch.label,
                attribute: 'brand',
                source: 'PREPASS_DETERMINISTIC',
                categories: brandMatch.categories,
                globalWordIndex: i
            });
            consumed.add(i);
            continue;
        }

        // Check non-brand clauses
        const clauseMatch = CLAUSE_LOOKUP.get(words[i]);
        if (clauseMatch) {
            globalEntities.push({
                type: 'clause',
                value: clauseMatch.word,
                clauseId: clauseMatch.clauseId,
                clauseLabel: clauseMatch.label,
                attribute: clauseMatch.attribute,
                source: 'PREPASS_DETERMINISTIC',
                categories: clauseMatch.categories,
                globalWordIndex: i
            });
            consumed.add(i);
        }
    }

    if (globalEntities.length > 0) {
        logDebug('PREPASS:DETERMINISTIC_HITS', {
            _desc: 'Deterministic pre-pass hits — exact word matches from CLAUSE_LOOKUP / BRAND_LOOKUP',
            _example: '"cheap" → affordable clause, "infinix" → infinix_product brand',
            matchCount: globalEntities.length,
            matches: globalEntities.map(e => ({
                word: e.value,
                clauseId: e.clauseId,
                type: e.type,
                attribute: e.attribute
            }))
        });
    }

    // ── Step 2: Semantic Pass (TF-IDF fallback for fuzzy matches) ──
    const matcher = getMatcher();
    if (matcher.isLoaded) {
        const unconsumedText = words
            .filter((w, i) => !consumed.has(i) && !FILLERS.has(w) && w.length > 1)
            .join(' ');

        if (unconsumedText.length > 0) {
            const semanticMatches = matcher.findMatches(unconsumedText);
            const alreadyDetectedIds = new Set(globalEntities.map(e => e.clauseId));

            for (const sm of semanticMatches) {
                if (sm.similarity < 0.4 && sm.boost < 1.8) continue;
                if (alreadyDetectedIds.has(sm.id)) continue;

                const clauseDef = CLAUSES[sm.id];
                if (!clauseDef) continue;

                // Find which word triggered the match using bench variations + clause words
                const clauseWords = [clauseDef.label, ...(clauseDef.matches || [])];
                const benchVariations = matcher.benchData?.[sm.id]?.variations || [];
                const allTargets = [...clauseWords, ...benchVariations].map(w => w.toLowerCase());

                for (let i = 0; i < words.length; i++) {
                    if (consumed.has(i) || FILLERS.has(words[i])) continue;

                    const wordMatch = allTargets.some(target =>
                        target === words[i] || target.includes(words[i]) || words[i].includes(target)
                    );

                    if (wordMatch) {
                        const entityType = clauseDef.attribute === 'brand' ? 'brand' : 'clause';
                        globalEntities.push({
                            type: entityType,
                            value: words[i],
                            clauseId: sm.id,
                            clauseLabel: clauseDef.label,
                            attribute: clauseDef.attribute,
                            source: 'PREPASS_SEMANTIC',
                            similarity: sm.similarity,
                            boost: sm.boost,
                            categories: clauseDef.categories || [],
                            globalWordIndex: i
                        });
                        consumed.add(i);
                        alreadyDetectedIds.add(sm.id);

                        logDebug('PREPASS:SEMANTIC_MATCH', {
                            _desc: 'Semantic pre-pass match — TF-IDF/Dice matched a word to a clause',
                            _example: '"bucksaving" → affordable clause (similarity=1.000)',
                            word: words[i],
                            clauseId: sm.id,
                            clauseLabel: clauseDef.label,
                            attribute: clauseDef.attribute,
                            similarity: sm.similarity?.toFixed?.(3),
                            boost: sm.boost?.toFixed?.(3)
                        });
                        break;
                    }
                }
            }
        }
    }

    // ── Step 3: Aggregate Category Hints ──
    const categoryHints = new Set();
    for (const ent of globalEntities) {
        if (ent.categories) {
            ent.categories.forEach(cat => categoryHints.add(cat));
        }
    }

    if (categoryHints.size > 0) {
        logDebug('PREPASS:CATEGORY_HINTS', {
            _desc: 'Category hints from pre-pass — aggregated from detected clause/brand entities',
            _example: '"cheap" clause → hints: [smartphones, tablets, laptops_&_computers]',
            hintCount: categoryHints.size,
            hints: Array.from(categoryHints),
            sourceClauses: globalEntities.map(e => e.clauseId)
        });
    }

    logDebug('PREPASS:SUMMARY', {
        _desc: 'Global Pre-pass summary — all clauses/brands detected before statement splitting',
        _example: '2 entities detected, 3 category hints generated',
        entityCount: globalEntities.length,
        entities: globalEntities.map(e => ({
            type: e.type,
            value: e.value,
            clauseId: e.clauseId,
            source: e.source,
            globalWordIndex: e.globalWordIndex
        })),
        categoryHintCount: categoryHints.size
    });

    return {
        globalEntities,
        categoryHints: Array.from(categoryHints)
    };
}

module.exports = { resolveClausesGlobal, resolveClauses };

/**
 * Legacy backward-compatible wrapper for searchUtility.js
 * Returns the old { clauses: [], display_words: [] } shape.
 */
async function resolveClauses(userMessage, category, conversationHistory = []) {
    const result = resolveClausesGlobal(userMessage);
    if (result.globalEntities.length === 0) {
        return { clauses: [], display_words: [] };
    }
    return {
        clauses: result.globalEntities.map(e => e.clauseId),
        display_words: result.globalEntities.map(e => e.value)
    };
}
