/**
 * Response Resolver Utilities
 * Pure functions for deterministic interpretation of user responses
 * within microstate sandboxes.
 * 
 * No state, no side effects — safe to call anywhere.
 */

// ── Explicit Engineered Tokens (microstate/control) ──

/**
 * Resolve explicit engineered tokens like __flow:cancel, __nav:more.
 * @param {string} text
 * @returns {{ raw: string, namespace: string, command: string, arg: string|null }|null}
 */
function resolveEngineeredToken(text) {
    if (!text) return null;
    const raw = String(text).trim();

    // Canonical format: __namespace:command(:arg)__
    const m = raw.match(/^__([a-z0-9_]+):([a-z0-9_]+)(?::([^\s]+))?__$/i);
    if (m) {
        return {
            raw: raw,
            namespace: String(m[1] || '').toLowerCase(),
            command: String(m[2] || '').toLowerCase(),
            arg: m[3] || null
        };
    }

    // Alias format observed from some WA button payloads: __navmore__ (no colons)
    // Support a small allowlist of deterministic control tokens.
    const aliasMap = {
        '__navmore__': { namespace: 'nav', command: 'more', arg: null },
        '__navprev__': { namespace: 'nav', command: 'prev', arg: null },
        '__flowcancel__': { namespace: 'flow', command: 'cancel', arg: null },
        '__flowskip__': { namespace: 'flow', command: 'skip', arg: null }
    };
    const aliased = aliasMap[String(raw).toLowerCase()];
    if (aliased) {
        return {
            raw: raw,
            namespace: aliased.namespace,
            command: aliased.command,
            arg: aliased.arg
        };
    }

    return null;
}

// ── Yes/No Resolution ──

const YES_WORDS = new Set([
    'yes', 'yeah', 'yep', 'yup', 'ya', 'ye', 'sure', 'ok', 'okay',
    'absolutely', 'definitely', 'of course', 'go ahead', 'proceed',
    'do it', 'confirm', 'correct', 'right', 'true', 'affirmative',
    'please', 'lets go', "let's go", 'why not', 'sounds good',
    'alright', 'fine', 'bet', 'cool', 'done', 'approved', 'accept'
]);

const NO_WORDS = new Set([
    'no', 'nah', 'nope', 'never', 'cancel', 'stop', 'dont', "don't",
    'negative', 'wrong', 'false', 'nevermind', 'forget it', 'back',
    'exit', 'quit', 'abort', 'not', 'decline', 'skip', 'pass',
    'no thanks', 'nah fam', 'naw'
]);

/**
 * Resolve natural text to yes/no/ambiguous
 * @param {string} text - User's raw message
 * @returns {'yes'|'no'|'ambiguous'}
 */
function resolveYesNo(text) {
    if (!text) return 'ambiguous';
    const clean = text.toLowerCase().trim().replace(/[!?.,']+/g, '');

    // Exact match first (highest confidence)
    if (YES_WORDS.has(clean)) return 'yes';
    if (NO_WORDS.has(clean)) return 'no';

    // Check if text starts with a yes/no signal
    for (const w of NO_WORDS) {
        if (clean.startsWith(w + ' ') || clean === w) return 'no';
    }
    for (const w of YES_WORDS) {
        if (clean.startsWith(w + ' ') || clean === w) return 'yes';
    }

    // Check contains (lower priority — "no" inside a longer phrase)
    const words = clean.split(/\s+/);
    if (words[0] === 'no' || words[0] === 'nah' || words[0] === 'nope') return 'no';
    if (words[0] === 'yes' || words[0] === 'yeah' || words[0] === 'sure') return 'yes';

    return 'ambiguous';
}


// ── Ordinal Resolution ──

const ORDINAL_MAP = {
    'first': 1, '1st': 1, '#1': 1, 'one': 1, '1': 1, 'the first': 1, 'the first one': 1,
    'second': 2, '2nd': 2, '#2': 2, 'two': 2, '2': 2, 'the second': 2, 'the second one': 2,
    'third': 3, '3rd': 3, '#3': 3, 'three': 3, '3': 3, 'the third': 3, 'the third one': 3,
    'fourth': 4, '4th': 4, '#4': 4, 'four': 4, '4': 4,
    'fifth': 5, '5th': 5, '#5': 5, 'five': 5, '5': 5,
    'sixth': 6, '6th': 6, '#6': 6, 'six': 6, '6': 6,
    'seventh': 7, '7th': 7, 'seven': 7, '7': 7,
    'eighth': 8, '8th': 8, 'eight': 8, '8': 8,
    'ninth': 9, '9th': 9, 'nine': 9, '9': 9,
    'tenth': 10, '10th': 10, 'ten': 10, '10': 10,
    'eleventh': 11, '11th': 11, '11': 11,
    'twelfth': 12, '12th': 12, 'twelvth': 12, '12': 12,
    'last': -1, 'the last': -1, 'the last one': -1,
};

/**
 * Resolve ordinal text to a 1-based index
 * @param {string} text - User's raw message
 * @returns {number|null} index (1-based), or -1 for "last", or null if not ordinal
 */
function resolveOrdinal(text) {
    if (!text) return null;
    const clean = text.toLowerCase().trim().replace(/[!?.,']+/g, '');

    // Direct match
    if (ORDINAL_MAP.hasOwnProperty(clean)) return ORDINAL_MAP[clean];

    // "number N" / "option N" / "pick N" / "choose N" / "no N" or just a digit
    const directDigitMatch = clean.match(/^(\d+)$/);
    if (directDigitMatch) {
        const n = parseInt(directDigitMatch[1], 10);
        if (!Number.isNaN(n) && n >= 1) return n;
    }

    const prefixedDigitMatch = clean.match(/^(?:option|number|no|#|pick|choose)\s*#?\s*(\d+)$/);
    if (prefixedDigitMatch) {
        const n = parseInt(prefixedDigitMatch[1], 10);
        if (!Number.isNaN(n) && n >= 1) return n;
    }

    // "the Nth" pattern
    const nthMatch = clean.match(/^(?:the\s+)?(\d+)(?:st|nd|rd|th)$/);
    if (nthMatch) return parseInt(nthMatch[1]);

    return null;
}

// ── Grouped Ordinal (prefix + nominal): "first two", "top two", "last three" ──
const GROUPED_NUMBER_WORDS = { 'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5, 'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10 };

/**
 * Resolve phrase like "first two", "top two", "last three" to 0-based indices into a list.
 * @param {string} phrase - User phrase (e.g. "top two", "first three", "last two")
 * @param {number} listLength - Length of the list (e.g. search_context.product_ids.length)
 * @returns {number[]|null} 0-based indices, or null if not a grouped ordinal
 */
function resolveGroupedOrdinal(phrase, listLength) {
    if (!phrase || listLength === 0) return null;
    const clean = phrase.toLowerCase().trim().replace(/[!?.,']+/g, '');

    // "first N" / "top N" → [0 .. N-1]
    const firstMatch = clean.match(/^(?:first|top)\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d+)$/);
    if (firstMatch) {
        const n = GROUPED_NUMBER_WORDS[firstMatch[1]] || (parseInt(firstMatch[1], 10) >= 1 ? parseInt(firstMatch[1], 10) : null);
        if (n != null && n >= 1) {
            const count = Math.min(n, listLength);
            return Array.from({ length: count }, (_, i) => i);
        }
    }

    // "last N" → [listLength-N .. listLength-1]
    const lastMatch = clean.match(/^last\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d+)$/);
    if (lastMatch) {
        const n = GROUPED_NUMBER_WORDS[lastMatch[1]] || (parseInt(lastMatch[1], 10) >= 1 ? parseInt(lastMatch[1], 10) : null);
        if (n != null && n >= 1) {
            const count = Math.min(n, listLength);
            const start = listLength - count;
            return Array.from({ length: count }, (_, i) => start + i);
        }
    }

    return null;
}


// ── Selection Resolution ──

/**
 * Resolve user text against a list of options
 * Uses ordinal resolution + exact/partial text matching
 * 
 * @param {string} text - User's raw message
 * @param {Array<{label: string, value: any}|string>} options - Available options
 * @returns {{ match: any, index: number, confidence: number }|null}
 */
function resolveSelection(text, options) {
    if (!text || !options || options.length === 0) return null;
    const clean = text.toLowerCase().trim();

    // Normalize options to { label, value } format
    const normalized = options.map((opt, i) => {
        if (typeof opt === 'string') return { label: opt, value: opt, index: i };
        return { label: opt.label || String(opt), value: opt.value || opt, index: i };
    });

    // 1. Try ordinal first
    const ordinal = resolveOrdinal(text);
    if (ordinal !== null) {
        const idx = ordinal === -1 ? normalized.length - 1 : ordinal - 1;
        if (idx >= 0 && idx < normalized.length) {
            return { match: normalized[idx].value, index: idx, confidence: 1.0 };
        }
    }

    // 2. Exact match on label
    for (const opt of normalized) {
        if (opt.label.toLowerCase() === clean) {
            return { match: opt.value, index: opt.index, confidence: 1.0 };
        }
    }

    // 3. Partial match — user text contained in label or vice versa
    for (const opt of normalized) {
        const label = opt.label.toLowerCase();
        if (label.includes(clean) || clean.includes(label)) {
            return { match: opt.value, index: opt.index, confidence: 0.85 };
        }
    }

    // 4. Word overlap scoring
    const cleanWords = new Set(clean.split(/\s+/));
    let bestMatch = null;
    let bestOverlap = 0;

    for (const opt of normalized) {
        const labelWords = new Set(opt.label.toLowerCase().split(/\s+/));
        let overlap = 0;
        for (const w of cleanWords) {
            if (labelWords.has(w)) overlap++;
        }
        const score = overlap / Math.max(cleanWords.size, labelWords.size);
        if (score > bestOverlap && score >= 0.4) {
            bestOverlap = score;
            bestMatch = { match: opt.value, index: opt.index, confidence: score * 0.8 };
        }
    }

    return bestMatch;
}


// ── Multi-Selection Resolution ──

/**
 * Resolve "1 and 3" or "first and third" into multiple selections
 * @param {string} text
 * @param {Array} options
 * @returns {Array<{ match: any, index: number }>|null}
 */
function resolveMultiSelection(text, options) {
    if (!text || !options) return null;
    const clean = text.toLowerCase().trim();

    // Split on "and", "&", ",", "+"
    const parts = clean.split(/\s+and\s+|\s*&\s*|\s*,\s*|\s*\+\s*/);
    if (parts.length < 2) return null;

    const results = [];
    for (const part of parts) {
        const sel = resolveSelection(part.trim(), options);
        if (sel) results.push(sel);
    }

    return results.length >= 2 ? results : null;
}


// ── Termination Keywords ──

const DEFAULT_TERMINATION_KEYWORDS = ['cancel', 'nevermind', 'forget it', 'stop', 'exit', 'back', 'quit'];

/**
 * Check if user text matches termination keywords
 * @param {string} text
 * @param {string[]} keywords - Custom keywords, or uses defaults
 * @returns {boolean}
 */
function isTerminationKeyword(text, keywords = DEFAULT_TERMINATION_KEYWORDS) {
    if (!text) return false;
    const clean = text.toLowerCase().trim().replace(/[!?.,']+/g, '');
    return keywords.some(kw => clean === kw || clean.startsWith(kw + ' '));
}


module.exports = {
    resolveEngineeredToken,
    resolveYesNo,
    resolveOrdinal,
    resolveGroupedOrdinal,
    resolveSelection,
    resolveMultiSelection,
    isTerminationKeyword
};
