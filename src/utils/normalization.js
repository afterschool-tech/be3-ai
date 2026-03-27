/**
 * Normalization Utility
 * Shared logic for resolving user-provided strings to store entities.
 */

const { CATEGORIES, VENDORS } = require('../context/storeContext');
const { logDebug } = require('./debugLogger');
const CATEGORY_ALIASES = require('../context/categoryAliases');

// ── Normalization Cache (Memoization) ──
// Prevents redundant processing of identical strings across the pipeline and tools.
// Caches: String -> Resolved_ID (or ID+Meta if returnMeta is true)
const normalizationCache = new Map();

/**
 * Normalizes a category string (label, slug, or breadcrumb) to a valid Category ID.
 * @param {string} cat - The input category string.
 * @param {Object} [context] - Optional categories context.
 * @param {boolean} [exactMatchOnly=false] - If true, only returns IDs for exact label/slug matches.
 * @param {Object} [options] - Resolution options (hints, transformer, etc.)
 * @returns {string|null} - The Category UUID or null.
 */
function normalizeCategory(cat, context = null, exactMatchOnly = false, options = {}) {
    if (!cat) return null;

    const initiator = options?.initiator || 'unknown';
    const returnMeta = !!options?.returnMeta;
    const catLower = String(cat || '').trim().toLowerCase();

    // ── Cache Key Generation ──
    // Consider input, exactMatch mode, and hints for cache uniqueness.
    const hintHash = Array.isArray(options.categoryHints) ? options.categoryHints.join(',') : '';
    const cacheKey = `${catLower}|exact:${exactMatchOnly}|meta:${returnMeta}|hints:${hintHash}`;

    if (normalizationCache.has(cacheKey)) {
        const cached = normalizationCache.get(cacheKey);
        if (options.debug !== false) { // Don't log if explicitly silenced (e.g. n-gram loop)
            logDebug('NORMALIZE_CATEGORY:CACHE_HIT', {
                _icon: '⚡',
                _desc: `normalizeCategory [${initiator}]: CACHE_HIT`,
                input: cat,
                winner: returnMeta ? (cached?.meta?.label || cached?.id) : cached,
                initiator
            });
        }
        return cached;
    }

    const cats = context || CATEGORIES;
    const debug = !!options?.debug;
    const topK = Number.isFinite(options?.topK) ? Math.max(1, Math.min(25, options.topK)) : 5;
    const semanticContext = options?.semanticContext || null;

    const result = (id, meta) => {
        if (!id) return null;
        const res = returnMeta ? { id, meta: meta || null } : id;
        
        // Populate cache before returning
        normalizationCache.set(cacheKey, res);
        return res;
    };

    // Guard: avoid partial-matching extremely short tokens (e.g., "in", "on", "at")
    // which can accidentally match inside real category labels ("All in one PCs").
    // Still allow exact-match resolution (keys/labels/slugs/ids).
    const isTooShortForPartial = catLower.length < 3;

    // 1. Handle breadcrumbs
    if (catLower.includes('>')) {
        catLower = catLower.split('>').pop().trim();
    }

    // 2. Direct match with key
    if (cats[catLower]) {
        if (debug) {
            logDebug('NORMALIZE_CATEGORY:KEY_HIT', {
                _type: 'CATEGORY_RESOLUTION_SIMPLE',
                _icon: '🔑',
                _color: '#3b82f6',
                _desc: `normalizeCategory [${initiator}] — direct key/slug match`,
                initiator,
                input: cat,
                targetId: cats[catLower].id,
                label: cats[catLower].label
            });
        }
        return result(cats[catLower].id, {
            layer: 'key',
            match: { field: 'key', query: catLower },
            usedWords: [catLower]
        });
    }

    const normalizeLoose = (s) => String(s || '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const singularize = (w) => {
        const x = String(w || '').toLowerCase().trim();
        if (x.endsWith('ies') && x.length > 4) return x.slice(0, -3) + 'y';
        if (x.endsWith('es') && x.length > 3) return x.slice(0, -2);
        if (x.endsWith('s') && x.length > 3) return x.slice(0, -1);
        return x;
    };

    const pluralize = (w) => {
        const x = String(w || '').toLowerCase().trim();
        if (!x) return x;
        if (x.endsWith('y') && x.length > 2) return x.slice(0, -1) + 'ies';
        if (x.endsWith('s')) return x;
        return x + 's';
    };

    const tokenize = (s) => String(s || '')
        .toLowerCase()
        .split(/[\s\-_\/]+/g)
        .map(t => t.trim())
        .filter(Boolean);

    // ── Alias Inventory Override (CONDITIONAL FALLBACK) ──
    // If the transformer is available, aliasing is SKIPPED (transformer provides semantic coverage).
    // If the transformer is unreachable, aliasing activates as the default behavior.
    const resolveAliasTargetId = (keyOrId) => {
        if (!keyOrId) return null;
        const k = String(keyOrId).trim();
        if (!k) return null;
        const direct = Object.values(cats).find(c => c && (c.id === k || c.slug === k));
        if (direct && direct.id) return direct.id;
        if (cats[k] && cats[k].id) return cats[k].id;
        // Fallback: lookup by label (case-insensitive)
        const byLabel = Object.values(cats).find(c => c && String(c.label || '').toLowerCase().trim() === k.toLowerCase());
        return byLabel?.id || null;
    };

    const inputTokens = tokenize(catLower);
    const inputLoose = normalizeLoose(catLower);

    // Alias matching should not consider ultra-short / filler tokens (e.g. "i"),
    // but it should still allow full-phrase alias hits via inputLoose.
    const MIN_ALIAS_TOKEN_LEN = 3;
    const ALIAS_STOPWORDS = new Set([
        'i', 'me', 'my', 'we', 'us', 'you', 'your',
        'the', 'a', 'an',
        'is', 'are', 'was', 'were', 'am',
        'to', 'of', 'in', 'for', 'on', 'at', 'by', 'with', 'from',
        'this', 'that', 'these', 'those',
        'and', 'or', 'but',
        'need', 'want', 'show', 'find', 'get', 'give', 'tell', 'look', 'looking'
    ]);

    const tokenVariants = new Set();
    for (const t of inputTokens) {
        if (!t) continue;
        if (t.length < MIN_ALIAS_TOKEN_LEN) continue;
        if (ALIAS_STOPWORDS.has(t)) continue;
        tokenVariants.add(t);
        tokenVariants.add(singularize(t));
        tokenVariants.add(pluralize(singularize(t)));
    }

    const transformerAvailable = !!semanticContext?.available;

    if (!transformerAvailable) {
        // Transformer DOWN → Alias takes precedence (default behavior)
        if (debug) {
            logDebug('NORMALIZE_CATEGORY:ALIAS_STATUS', {
                _icon: '🔄',
                _desc: `normalizeCategory [${initiator}] — Alias matching ACTIVATED — transformer unavailable`,
                initiator,
                input: cat,
                reason: 'TRANSFORMER_DOWN'
            });
        }

        if (CATEGORY_ALIASES && typeof CATEGORY_ALIASES === 'object') {
            for (const [targetKeyOrId, aliases] of Object.entries(CATEGORY_ALIASES)) {
                if (!Array.isArray(aliases) || aliases.length === 0) continue;
                const targetId = resolveAliasTargetId(targetKeyOrId);
                if (!targetId) continue;
                for (const a of aliases) {
                    const alias = normalizeLoose(a);
                    if (!alias) continue;
                    if (tokenVariants.has(alias) || (inputLoose && inputLoose === alias)) {
                        if (debug) {
                            const resolved = Object.values(cats).find(c => c && c.id === targetId);
                            logDebug('NORMALIZE_CATEGORY:ALIAS_STATUS', {
                                _icon: '💥',
                                _desc: `normalizeCategory [${initiator}] — alias inventory override (transformer down)`,
                                initiator,
                                alias: a,
                                input: cat,
                                matchedAlias: a,
                                aliasStatus: 'ACTIVATED_TRANSFORMER_DOWN',
                                target: {
                                    id: targetId,
                                    label: resolved?.label,
                                    slug: resolved?.slug
                                },
                                context: {
                                    inputLoose,
                                    variants: Array.from(tokenVariants).slice(0, 5)
                                }
                            });
                        }
                        return result(targetId, {
                            layer: 'alias',
                            matchedAlias: a,
                            matchedAliasLoose: alias,
                            inputLoose,
                            aliasStatus: 'ACTIVATED_TRANSFORMER_DOWN',
                            usedWords: inputTokens.filter(t => {
                                const tSing = singularize(t);
                                const variants = [t.toLowerCase(), tSing, pluralize(tSing)];
                                return variants.some(v => alias.includes(v));
                            })
                        });
                    }
                }
            }
        }
    } else {
        // Transformer UP → Alias SKIPPED
        if (debug) {
            logDebug('NORMALIZE_CATEGORY:ALIAS_STATUS', {
                _icon: '⏭️',
                _desc: `normalizeCategory [${initiator}] — Alias matching SKIPPED — transformer available`,
                initiator,
                input: cat,
                reason: 'SKIPPED_TRANSFORMER_AVAILABLE'
            });
        }
    }

    const editDistance = (a, b, max = 2) => {
        const s = String(a || '');
        const t = String(b || '');
        if (s === t) return 0;
        const n = s.length;
        const m = t.length;
        if (Math.abs(n - m) > max) return max + 1;
        if (n === 0) return m;
        if (m === 0) return n;

        const v0 = new Array(m + 1);
        const v1 = new Array(m + 1);
        for (let j = 0; j <= m; j++) v0[j] = j;

        for (let i = 0; i < n; i++) {
            v1[0] = i + 1;
            let rowMin = v1[0];
            const si = s.charCodeAt(i);
            for (let j = 0; j < m; j++) {
                const cost = si === t.charCodeAt(j) ? 0 : 1;
                const del = v0[j + 1] + 1;
                const ins = v1[j] + 1;
                const sub = v0[j] + cost;
                const val = Math.min(del, ins, sub);
                v1[j + 1] = val;
                if (val < rowMin) rowMin = val;
            }
            if (rowMin > max) return max + 1;
            for (let j = 0; j <= m; j++) v0[j] = v1[j];
        }
        return v0[m];
    };

    const catLoose = normalizeLoose(catLower);
    const catLooseSing = singularize(catLoose);
    const catLoosePlural = pluralize(catLooseSing);
    const layer1Queries = Array.from(new Set([catLower, catLoose, catLooseSing, catLoosePlural].filter(Boolean)));

    const layer1ScoreFor = (query, target) => {
        const q = normalizeLoose(query);
        const t = normalizeLoose(target);
        if (!q || !t) return 0;
        if (q === t) return 100;
        const qSing = singularize(q);
        const tSing = singularize(t);
        if (qSing && tSing && qSing === tSing) return 98;
        const maxEd = Math.min(2, Math.floor(Math.max(qSing.length, tSing.length) / 6));
        if (maxEd > 0) {
            const d = editDistance(qSing, tSing, maxEd);
            if (d <= maxEd) return 96 - (d * 2);
        }
        return 0;
    };

    const idToCat = {};
    for (const c of Object.values(cats)) {
        if (c && c.id) idToCat[c.id] = c;
    }

    const layer1Candidates = [];
    for (const c of Object.values(cats)) {
        if (!c || (!c.label && !c.slug && !c.id)) continue;
        const labelLower = (c.label || '').toLowerCase();
        const slugLower = (c.slug || '').toLowerCase();
        const idLower = (c.id || '').toLowerCase();

        let best = 0;
        let bestQuery = null;
        let bestField = null;
        for (const q of layer1Queries) {
            const s1 = layer1ScoreFor(q, labelLower);
            if (s1 > best) {
                best = s1;
                bestQuery = q;
                bestField = 'label';
            }
            const s2 = layer1ScoreFor(q, slugLower);
            if (s2 > best) {
                best = s2;
                bestQuery = q;
                bestField = 'slug';
            }
            if (idLower && normalizeLoose(q) === normalizeLoose(idLower)) {
                if (100 > best) {
                    best = 100;
                    bestQuery = q;
                    bestField = 'id';
                }
            }
        }

        if (best > 0) {
            layer1Candidates.push({
                id: c.id,
                score: best,
                match: { field: bestField, query: bestQuery, baseScore: best }
            });
        }
    }

    if (layer1Candidates.length > 0) {
        layer1Candidates.sort((a, b) => b.score - a.score);
        const winner = layer1Candidates[0];
        if (winner && winner.id) {
            if (debug) {
                const resolved = idToCat[winner.id];
                logDebug('NORMALIZE_CATEGORY:LAYER1', {
                    _type: 'CATEGORY_RESOLUTION_SIMPLE',
                    _icon: '🏁',
                    _color: '#10b981',
                    _desc: `normalizeCategory [${initiator}] — layer1 exact/plural match`,
                    initiator,
                    input: cat,
                    winner: {
                        id: winner.id,
                        label: resolved?.label,
                        score: winner.score,
                        match: winner.match
                    }
                });
            }
            return result(winner.id, {
                layer: 'layer1',
                score: winner.score,
                match: winner.match,
                usedWords: tokenize(winner.match.query)
            });
        }
    }

    if (exactMatchOnly) return null;

    const MIN_LAYER2_TOKEN_LEN = 3;
    const LAYER2_STOPWORDS = new Set([
        'i', 'me', 'my', 'we', 'us', 'you', 'your',
        'the', 'a', 'an',
        'is', 'are', 'was', 'were', 'am',
        'to', 'of', 'in', 'for', 'on', 'at', 'by', 'with', 'from',
        'this', 'that', 'these', 'those',
        'and', 'or', 'but',
        'need', 'want', 'show', 'find', 'get', 'give', 'tell', 'look', 'looking'
    ]);

    const makeVariants = (w) => {
        const x = String(w || '').toLowerCase().trim();
        if (x.length < MIN_LAYER2_TOKEN_LEN) return [];
        const out = new Set([x, singularize(x), pluralize(x)]);
        return Array.from(out).filter(Boolean);
    };

    const getDepth = (catObj) => {
        let depth = 0;
        const seen = new Set();
        let cur = catObj;
        while (cur && cur.parent_id && !seen.has(cur.parent_id)) {
            seen.add(cur.parent_id);
            const parent = idToCat[cur.parent_id];
            if (!parent) break;
            depth += 1;
            cur = parent;
            if (depth > 20) break;
        }
        return depth;
    };

    const inferWordsRaw = tokenize(catLower);
    const inferWords = inferWordsRaw.filter(w => w.length >= MIN_LAYER2_TOKEN_LEN && !LAYER2_STOPWORDS.has(w));

    // Refactored early exit: Allow loop if we have semantic or hint context
    const hasSemanticContext = !!(semanticContext?.available && semanticContext.entities?.category?.length > 0);
    const hasHints = !!(options?.categoryHints && options.categoryHints.length > 0);

    if (inferWords.length === 0 && !hasSemanticContext && !hasHints) {
        return null;
    }

    const scored = [];
    for (const c of Object.values(cats)) {
        if (!c || (!c.label && !c.slug)) continue;
        const label = String(c.label || '').toLowerCase().trim();
        const slug = String(c.slug || '').toLowerCase().trim();
        if (!label && !slug) continue;

        const labelTokens = tokenize(label);
        const slugTokens = tokenize(slug);
        const allTokens = [...new Set([...labelTokens, ...slugTokens])];

        // Clean label words (no stop-words) to get the true biological word count
        const cleanLabelWords = labelTokens.filter(t => !LAYER2_STOPWORDS.has(t));
        const totalWordsInLabel = Math.max(1, cleanLabelWords.length);

        const wordMatches = [];
        for (const w of inferWords) {
            const variants = makeVariants(w);
            let bestTier = 0;
            let bestTierPoints = 0;
            let bestDetails = null;

            if (label === w || slug === w) {
                bestTier = 4;
                bestTierPoints = 100;
                bestDetails = { type: 'exact_query', word: w, variant: w };
            }

            if (bestTier < 4) {
                for (const v of variants) {
                    if (allTokens.includes(v)) {
                        bestTier = 4;
                        bestTierPoints = 95;
                        bestDetails = { type: 'token_exact', word: w, variant: v };
                        break;
                    }
                }
            }

            if (bestTier < 3) {
                for (const v of variants) {
                    for (const t of allTokens) {
                        if (!t) continue;
                        if (t === v) continue;
                        if (t.startsWith(v) || t.endsWith(v)) {
                            bestTier = 3;
                            bestTierPoints = 75;
                            bestDetails = { type: 'token_compound', word: w, variant: v, token: t };
                            break;
                        }
                    }
                    if (bestTier === 3) break;
                }
            }

            if (bestTier < 2) {
                for (const v of variants) {
                    if ((label && label.includes(v)) || (slug && slug.includes(v))) {
                        bestTier = 2;
                        bestTierPoints = 35;
                        bestDetails = { type: 'substring', word: w, variant: v };
                        break;
                    }
                }
            }

            if (bestTier > 0) {
                // Apply Precision Slasher: Dilute the tier points by the clean category word count
                const dilutedScore = bestTierPoints / totalWordsInLabel;
                wordMatches.push({ word: w, tier: bestTier, score: dilutedScore, details: bestDetails });
            }
        }

        // 4. HINT Membership Boost: Adder for contextually identified categories
        let hintBoost = 0;
        if (options.categoryHints && Array.isArray(options.categoryHints)) {
            if (options.categoryHints.includes(c.id) || options.categoryHints.includes(c.slug)) {
                hintBoost = 20;
            }
        }

        // 5. SEMANTIC Transformer Boost & Tier Promotion
        let semanticBoost = 0;
        let semanticTier = 0;
        if (semanticContext?.available && semanticContext.entities?.category) {
            // Match against category slug, ID, or label
            const matchedKey = semanticContext.entities.category.find(
                k => k === c.id || k === c.slug || k === c.label?.toLowerCase()
            );

            if (matchedKey) {
                // Look up confidence score in the map (keys are category:key)
                const confKey = `category:${matchedKey}`;
                const score = semanticContext.confidence?.[confKey] || 0.85;

                // Scale semantic score into pipeline points (multiplier = 50)
                semanticBoost = score * 50;

                // --- Semantic Tier Promotion ---
                if (score >= 0.90) semanticTier = 4;
                else if (score >= 0.75) semanticTier = 3;
                else if (score >= 0.60) semanticTier = 2;
                else if (score >= 0.50) semanticTier = 1;
            }
        }

        // Skip if there's ZERO proof this category matches (no lexical, no hint, no semantic)
        if (wordMatches.length === 0 && hintBoost === 0 && semanticBoost === 0) continue;

        wordMatches.sort((a, b) => b.score - a.score);

        // --- FINAL SCORING: Intent Amplifier ---
        // 1. Purity Sum: Combine the diluted scores of all matching user words
        const puritySum = wordMatches.reduce((acc, m) => acc + m.score, 0);

        // 2. Coverage Multiplier: Amplify the score by the number of matches
        const matchedWordCount = wordMatches.length;
        const amplifiedScore = puritySum * matchedWordCount;

        // 3. Linear Kicker: Tie-breaker for perfect density matches (more specific wins)
        const kicker = matchedWordCount * 0.1;

        const lexScore = amplifiedScore + kicker;
        const lexTier = wordMatches[0]?.tier || 0;
        const finalTier = Math.max(lexTier, semanticTier);

        // Explicit Logging for Semantic Promotion
        if (semanticTier > lexTier && debug) {
            logDebug('NORMALIZE_CATEGORY:SEMANTIC_PROMOTION', {
                initiator,
                category: c.label,
                slug: c.slug,
                fromTier: lexTier,
                toTier: finalTier,
                confidence: semanticBoost / 50
            });
        }

        const depth = getDepth(c);
        const depthBonus = Math.min(4, depth) * 6;

        const finalScore = lexScore + depthBonus + hintBoost + semanticBoost;

        if (finalScore > 0 && debug) {
            logDebug('NORMALIZE_CATEGORY:SCORE_BREAKDOWN', {
                initiator,
                category: c.label,
                slug: c.slug,
                lexScore: lexScore.toFixed(2),
                lexTier,
                depthBonus: depthBonus.toFixed(2),
                hintBoost,
                semanticBoost: semanticBoost.toFixed(2),
                finalScore: finalScore.toFixed(2),
                wordMatches: wordMatches.map(m => m.word)
            });
        }

        scored.push({
            id: c.id,
            label: c.label,
            slug: c.slug,
            score: finalScore,
            lexTier: finalTier, // Competitive tier after promotion
            lexScore,
            depth,
            total_count: c.total_count,
            product_count: c.product_count,
            match: wordMatches[0]?.details,
            wordMatches: wordMatches.map(m => ({
                word: m.word,
                score: m.score.toFixed(2),
                type: m.details?.type,
                variant: m.details?.variant
            })),
            labelWordCount: totalWordsInLabel,
            bonuses: { depth: depthBonus, kicker, hint: hintBoost, semantic: semanticBoost },
            multipliers: { coverage: matchedWordCount, purity: puritySum }
        });
    }

    scored.sort((a, b) => {
        // 1. Highest lexTier wins (Exact query > Token match > Substring)
        if (b.lexTier !== a.lexTier) return b.lexTier - a.lexTier;

        // 2. Highest total score wins (Lexical Density + Semantic Boost + Hint Boost)
        if (b.score !== a.score) return b.score - a.score;

        // 3. Depth bonus tie-breaker (More specific categories preferred)
        if (b.depth !== a.depth) return b.depth - a.depth;

        // 4. Stable tie-breaker
        return String(a.id || '').localeCompare(String(b.id || ''));
    });

    if (scored.length === 0) return null;

    if (debug) {
        const winner = scored[0];
        logDebug('NORMALIZE_CATEGORY:LAYER2', {
            _type: 'INTENT_AMPLIFIER_DETAIL', // Specialized rendering in Telemetry UI
            _icon: '🎯',
            _color: '#6366f1', // Indigo premium color
            _desc: `normalizeCategory [${initiator}] — Final Result Summary`,
            _physics: '🧪 Purity (Density) x 🚀 Amplification (Coverage) + 🏁 Kicker + 💡 Hints',
            initiator,
            input: cat,
            exactMatchOnly,
            metadata: {
                totalCandidates: scored.length,
                matchedWords: inferWords
            },
            winner: winner ? {
                id: winner.id,
                label: winner.label,
                score: winner.score.toFixed(2),
                viz: {
                    purityBar: '▓'.repeat(Math.min(10, Math.round(winner.multipliers.purity / 10))) + '░'.repeat(Math.max(0, 10 - Math.round(winner.multipliers.purity / 10))),
                    coverageIcon: '🔥'.repeat(winner.multipliers.coverage)
                },
                breakdown: {
                    purity: `${winner.multipliers.purity.toFixed(2)}% (Slashed by ${winner.labelWordCount} words)`,
                    amplification: `x${winner.multipliers.coverage} matches`,
                    kicker: `+${winner.bonuses.kicker.toFixed(2)} (Tie-breaker)`,
                    hints: winner.bonuses.hint > 0 ? `+${winner.bonuses.hint} (HINT BOOST)` : 'None',
                    semantic: winner.bonuses.semantic > 0 ? `+${winner.bonuses.semantic.toFixed(2)} (TRANSFORMER BOOST)` : 'None',
                    depth: `+${winner.bonuses.depth} (Level ${winner.depth})`,
                    wordMatches: winner.wordMatches
                },
                matchType: winner.match?.type || 'semantic'
            } : null,
            competition: scored.slice(0, topK).map(x => ({
                id: x.id,
                label: x.label,
                score: x.score.toFixed(2),
                status: x.id === winner?.id ? 'WINNER' : 'CANDIDATE',
                viz: {
                    purityBar: '▓'.repeat(Math.min(10, Math.round(x.multipliers.purity / 10))) + '░'.repeat(Math.max(0, 10 - Math.round(x.multipliers.purity / 10))),
                    coverageIcon: '🔥'.repeat(x.multipliers.coverage)
                },
                breakdown: {
                    purity: `${x.multipliers.purity.toFixed(2)}% (Slashed by ${x.labelWordCount} words)`,
                    amplification: `x${x.multipliers.coverage} matches`,
                    kicker: `+${x.bonuses.kicker.toFixed(2)} (Tie-breaker)`,
                    hints: x.bonuses.hint > 0 ? `+${x.bonuses.hint} (HINT BOOST)` : 'None',
                    semantic: x.bonuses.semantic > 0 ? `+${x.bonuses.semantic.toFixed(2)} (TRANSFORMER BOOST)` : 'None',
                    depth: `+${x.bonuses.depth} (Level ${x.depth})`,
                    wordMatches: x.wordMatches
                },
                matchType: x.match?.type || 'semantic'
            }))
        });
    }

    return result(scored[0].id, {
        layer: 'layer2',
        score: scored[0].score,
        lexTier: scored[0].lexTier,
        lexScore: scored[0].lexScore,
        depth: scored[0].depth,
        match: scored[0].match,
        bonuses: scored[0].bonuses,
        usedWords: scored[0].wordMatches.map(m => m.word)
    });
}

/**
 * Normalizes a vendor string to the canonical business name.
 * Now supports history-based resolution for "their" or "this vendor".
 * @param {string} vendor - Input vendor string.
 * @param {Array} history - Interaction history.
 * @param {Object} [context] - Optional vendors context.
 */
function normalizeVendor(vendor, history = [], context = null) {
    if (!vendor) return null;
    const vendors = Object.values(context || VENDORS);
    const vendorLower = String(vendor || '').trim().toLowerCase();

    // 1. Resolve from history (e.g. "their", "this vendor")
    if (vendorLower === 'their' || vendorLower === 'this vendor' || vendorLower === 'that shop') {
        for (let i = history.length - 1; i >= 0; i--) {
            const entry = history[i];
            const text = entry.text.toLowerCase();
            const found = vendors.find(v => text.includes(v.business_name.toLowerCase()));
            if (found) return found.business_name;
        }
    }

    // 2. Direct match or partial match
    const match = vendors.find(v =>
        v.business_name.toLowerCase() === vendorLower ||
        vendorLower.includes(v.business_name.toLowerCase()) ||
        v.business_name.toLowerCase().includes(vendorLower)
    );

    if (match) return match.business_name;

    // 3. Punctuation-Robust Fallback (Strip non-alphanumeric)
    const strip = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const vendorStripped = strip(vendor);

    const robustMatch = vendors.find(v => {
        const canonicalStripped = strip(v.business_name);
        return canonicalStripped === vendorStripped ||
            canonicalStripped.includes(vendorStripped) ||
            vendorStripped.includes(canonicalStripped);
    });

    if (robustMatch) return robustMatch.business_name;

    // 4. FUZZY MATCHING — Dice Coefficient + Levenshtein Distance
    //    Catches typos like "Samsng" → "Samsung", "niike" → "Nike"
    const fuzzyResult = fuzzyMatchVendor(vendorLower, vendors);
    if (fuzzyResult) return fuzzyResult;

    return vendor; // Return original if nothing matches
}

/**
 * Fuzzy match a vendor string against all known vendors.
 * Uses bigram-based Dice coefficient for similarity and
 * Levenshtein distance as a tiebreaker.
 * 
 * @param {string} input - Lowercased user input
 * @param {Array} vendors - Array of vendor objects with business_name
 * @param {number} threshold - Minimum combined score (0-1) to accept a match
 * @returns {string|null} - Canonical business_name or null
 */
function fuzzyMatchVendor(input, vendors, threshold = 0.55) {
    if (!input || input.length < 2 || vendors.length === 0) return null;

    const inputBigrams = getBigrams(input);
    let bestMatch = null;
    let bestScore = 0;

    for (const v of vendors) {
        const name = v.business_name.toLowerCase();

        // Score against FULL name
        let score = computeFuzzyScore(input, name);

        // Also score against INDIVIDUAL WORDS for multi-word names
        // e.g. "Samsng" should score well against "Samsung" in "Samsung Electronics"
        const words = name.split(/\s+/).filter(w => w.length >= 3);
        for (const word of words) {
            const wordScore = computeFuzzyScore(input, word);
            score = Math.max(score, wordScore);
        }

        if (score > bestScore) {
            bestScore = score;
            bestMatch = v.business_name;
        }
    }

    if (bestScore >= threshold) {
        console.log(`[FuzzyVendor] "${input}" → "${bestMatch}" (score: ${bestScore.toFixed(3)})`);
        return bestMatch;
    }

    return null;
}

/** Compute combined Dice + Levenshtein similarity score between two strings */
function computeFuzzyScore(a, b) {
    const aBigrams = getBigrams(a);
    const bBigrams = getBigrams(b);
    const dice = diceCoefficient(aBigrams, bBigrams);

    const maxLen = Math.max(a.length, b.length);
    const editDist = levenshtein(a, b);
    const levSim = maxLen > 0 ? 1 - (editDist / maxLen) : 0;

    return (dice * 0.6) + (levSim * 0.4);
}

/** Generate character bigrams from a string */
function getBigrams(str) {
    const bigrams = new Set();
    for (let i = 0; i < str.length - 1; i++) {
        bigrams.add(str.substring(i, i + 2));
    }
    return bigrams;
}

/** Dice coefficient between two bigram sets */
function diceCoefficient(setA, setB) {
    if (setA.size === 0 && setB.size === 0) return 1;
    let intersection = 0;
    for (const bigram of setA) {
        if (setB.has(bigram)) intersection++;
    }
    return (2 * intersection) / (setA.size + setB.size);
}

/** Levenshtein edit distance (iterative, memory-efficient) */
function levenshtein(a, b) {
    const m = a.length, n = b.length;
    const dp = Array(n + 1).fill(0).map((_, j) => j);

    for (let i = 1; i <= m; i++) {
        let prev = dp[0];
        dp[0] = i;
        for (let j = 1; j <= n; j++) {
            const temp = dp[j];
            dp[j] = a[i - 1] === b[j - 1]
                ? prev
                : 1 + Math.min(prev, dp[j], dp[j - 1]);
            prev = temp;
        }
    }
    return dp[n];
}

// Ordinal words that can be part of category names OR used as references
const ORDINAL_WORDS = new Set([
    'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
    'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth',
    'last'
]);

// Words that indicate ordinal/reference context (when these precede ordinals, skip category matching)
const ORDINAL_INDICATORS = new Set([
    'the', 'it', 'this', 'that', 'compare', 'versus', 'vs', 'and', 'or'
]);

/**
 * Check if a phrase is being used as an ordinal/reference (skip category matching)
 * vs. part of a legitimate category name (allow matching).
 * 
 * Examples:
 * - "all in one" → NOT ordinal (contains "all", "in" - non-ordinal words)
 * - "the first one" → IS ordinal (preceded by "the", purely ordinal words)
 * - "second one" → IS ordinal (purely ordinal words, likely reference)
 * - "one" alone → IS ordinal (single ordinal word, likely reference)
 * 
 * @param {string} phrase - The phrase to check
 * @param {string} fullText - The full text context (optional, for better detection)
 * @param {number} phraseStartIndex - Start index of phrase in fullText (optional)
 * @returns {boolean} - True if phrase should be skipped (is ordinal/reference)
 */
function isOrdinalOrReferencePhrase(phrase, fullText = null, phraseStartIndex = -1) {
    if (!phrase || typeof phrase !== 'string') return false;

    const words = phrase.toLowerCase().trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return false;

    // If phrase contains non-ordinal words, it's likely a category name (e.g., "all in one")
    const hasNonOrdinalWords = words.some(w => !ORDINAL_WORDS.has(w) && !ORDINAL_INDICATORS.has(w));
    if (hasNonOrdinalWords) return false;

    // If phrase is purely ordinal words, check context
    const isPurelyOrdinal = words.every(w => ORDINAL_WORDS.has(w) || ORDINAL_INDICATORS.has(w));
    if (!isPurelyOrdinal) return false;

    // Check surrounding context if available
    if (fullText && phraseStartIndex >= 0) {
        const beforePhrase = fullText.substring(Math.max(0, phraseStartIndex - 20), phraseStartIndex).trim();
        const beforeWords = beforePhrase.toLowerCase().split(/\s+/).filter(Boolean);

        // If preceded by ordinal indicators or comparison words, it's likely a reference
        const hasOrdinalContext = beforeWords.length > 0 && (
            ORDINAL_INDICATORS.has(beforeWords[beforeWords.length - 1]) ||
            ORDINAL_WORDS.has(beforeWords[beforeWords.length - 1]) ||
            beforeWords.some(w => ['compare', 'versus', 'vs', 'difference', 'between'].includes(w))
        );

        if (hasOrdinalContext) return true;
    }

    // Default: if phrase is purely ordinal words (especially single word), treat as reference
    // This catches cases like "one" in "compare X and Y, the first one"
    return words.length === 1 || words.every(w => ORDINAL_WORDS.has(w));
}

module.exports = {
    normalizeCategory,
    normalizeVendor,
    ORDINAL_WORDS, // Export for reference (ordinal words that can be part of category names)
    isOrdinalOrReferencePhrase
};
