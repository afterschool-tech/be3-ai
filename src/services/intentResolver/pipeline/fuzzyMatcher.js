/**
 * Pipeline Stage 1: Fuzzy Matcher
 * Corrects vendor name typos in user input using Levenshtein distance.
 *
 * SCOPE: Vendor names only.
 * -------------------------------------------------------------------
 * The original implementation ran correction against ALL intent keywords,
 * category labels, and vendor names. This was too broad — it risked
 * mangling Nigerian/pidgin words, informal phrasing, and product names
 * that happened to be edit-distance-close to intent keywords.
 *
 * Vendor names are the primary real-world use case:
 *   - "Daerymi"      → "Dareymi"
 *   - "Bola Food"    → "Bola Foods"
 *   - "Tayes Decor"  → "Taye's Home Decor"
 *
 * Intent keywords are handled downstream by the transformer and entity
 * extractor — they do not need fuzzy correction at this stage.
 *
 * Multi-word vendor names are handled via a sliding window over the
 * input so a two-word vendor like "Bola Foods" can be matched even if
 * the user writes "Bola Food" (one word off).
 *
 * NOTE: When a better library is available (e.g. fastest-levenshtein),
 * swap out the levenshtein util import — the logic here stays the same.
 */

const { levenshtein } = require('../utils/levenshtein');
const stopWords = require('../config/stopWords');

// ── Constants ─────────────────────────────────────────────────────────────────

// Maximum edit distance allowed for a correction to be applied.
// Short vendor names (≤6 chars) use a tighter threshold of 1 to avoid
// false positives — e.g. "Be3" should not correct to "Be" or "Be4".
const MAX_DIST_DEFAULT = 2;
const MAX_DIST_SHORT = 1; // applied when vendor name length <= SHORT_NAME_THRESHOLD
const SHORT_NAME_THRESHOLD = 6;

// Minimum length ratio between the user token and the vendor name.
// Prevents "be" from matching "Be3" or "da" from matching "Dareymi".
const MIN_LENGTH_RATIO = 0.6;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Collect all vendor names and tags from store context.
 * Returns an array of { original, lower, words } objects for matching.
 */
function buildVendorList(storeContext) {
    const vendors = [];
    if (!storeContext?.VENDORS) return vendors;

    Object.values(storeContext.VENDORS).forEach(v => {
        [v.business_name, v.tag].forEach(name => {
            if (!name) return;
            const trimmed = name.trim();
            if (!trimmed) return;
            vendors.push({
                original: trimmed,
                lower: trimmed.toLowerCase(),
                words: trimmed.toLowerCase().split(/\s+/)
            });
        });
    });

    // Deduplicate by lower-cased value
    const seen = new Set();
    return vendors.filter(v => {
        if (seen.has(v.lower)) return false;
        seen.add(v.lower);
        return true;
    });
}

/**
 * Compute the maximum edit distance to allow for a given vendor name.
 * Shorter names get a tighter threshold to avoid false positives.
 */
function maxDistFor(vendorName) {
    return vendorName.length <= SHORT_NAME_THRESHOLD ? MAX_DIST_SHORT : MAX_DIST_DEFAULT;
}

/**
 * Check if the length ratio between a candidate and vendor name is acceptable.
 * Prevents very short fragments from matching long vendor names.
 */
function lengthRatioOk(candidateLen, vendorLen) {
    const ratio = Math.min(candidateLen, vendorLen) / Math.max(candidateLen, vendorLen);
    return ratio >= MIN_LENGTH_RATIO;
}

/**
 * Try to match a single word against all single-word vendor names.
 * Returns { corrected, vendorName } or null.
 */
function matchSingleWord(word, vendors) {
    const lower = word.toLowerCase();

    for (const vendor of vendors) {
        if (vendor.words.length !== 1) continue; // handled by phrase window

        const maxDist = maxDistFor(vendor.lower);

        // Already an exact match — no correction needed
        if (lower === vendor.lower) return null;

        if (!lengthRatioOk(lower.length, vendor.lower.length)) continue;

        const dist = levenshtein(lower, vendor.lower);
        if (dist > 0 && dist <= maxDist) {
            return { corrected: vendor.original, vendorName: vendor.original };
        }
    }
    return null;
}

/**
 * Try to match an n-word phrase (sliding window) against multi-word vendor names.
 * Returns { startIdx, endIdx, corrected, vendorName } or null.
 *
 * @param {string[]} words   - All words in the message (lowercased)
 * @param {number}   startIdx - Start of the window
 * @param {number}   windowSize - Number of words in the window
 * @param {Object[]} vendors - Vendor list from buildVendorList()
 */
function matchPhraseWindow(words, startIdx, windowSize, vendors) {
    const phrase = words.slice(startIdx, startIdx + windowSize).join(' ');

    for (const vendor of vendors) {
        if (vendor.words.length !== windowSize) continue;

        // Already exact — skip
        if (phrase === vendor.lower) return null;

        const maxDist = maxDistFor(vendor.lower);

        if (!lengthRatioOk(phrase.length, vendor.lower.length)) continue;

        const dist = levenshtein(phrase, vendor.lower);
        if (dist > 0 && dist <= maxDist) {
            return {
                startIdx,
                endIdx: startIdx + windowSize - 1,
                corrected: vendor.original,
                vendorName: vendor.original
            };
        }
    }
    return null;
}

// ── Main Export ───────────────────────────────────────────────────────────────

/**
 * Correct vendor name typos in user text.
 *
 * Strategy:
 *   1. Build the vendor list from store context.
 *   2. Tokenize the message.
 *   3. For multi-word vendor names: use a sliding window over the tokens.
 *      Longer windows are tried first (greedy, longest match wins).
 *   4. For single-word vendor names: match word by word.
 *   5. All other words are passed through unchanged.
 *
 * Guards:
 *   - Digits-only tokens are always skipped.
 *   - Stop words are always skipped.
 *   - Tokens ≤ 2 chars are skipped.
 *   - Length ratio check prevents short fragments matching long names.
 *   - Short vendor names (≤6 chars) require distance = 1, not 2.
 *   - Exact matches are never "corrected" (distance = 0 → skip).
 */
function correctText(text, storeContext) {
    const vendors = buildVendorList(storeContext);

    // Nothing to match against — return early
    if (vendors.length === 0) {
        return text;
    }

    const stopSet = new Set(stopWords);
    const rawWords = text.split(/\s+/);
    const lowerWords = rawWords.map(w => w.toLowerCase());

    // Find the maximum vendor word count so we know our largest window size
    const maxVendorWords = Math.max(...vendors.map(v => v.words.length));

    // Output array — same length as rawWords initially, will be rebuilt after phrase merges
    // We track which indices are "consumed" by a phrase match so they aren't double-processed.
    const consumed = new Array(rawWords.length).fill(false);
    const patches = []; // { startIdx, endIdx, replacement }

    // ── Pass 1: Multi-word vendor matching (sliding window, longest first) ──
    for (let windowSize = maxVendorWords; windowSize >= 2; windowSize--) {
        for (let i = 0; i <= rawWords.length - windowSize; i++) {
            // Skip if any word in this window is already consumed by a longer match
            if (consumed.slice(i, i + windowSize).some(Boolean)) continue;

            // Skip windows containing only stop words or digits
            const windowWords = lowerWords.slice(i, i + windowSize);
            if (windowWords.every(w => stopSet.has(w) || /^\d+$/.test(w) || w.length <= 2)) continue;

            const match = matchPhraseWindow(lowerWords, i, windowSize, vendors);
            if (match) {
                patches.push({ startIdx: match.startIdx, endIdx: match.endIdx, replacement: match.corrected });
                for (let j = i; j < i + windowSize; j++) consumed[j] = true;
            }
        }
    }

    // ── Pass 2: Single-word vendor matching ──
    for (let i = 0; i < rawWords.length; i++) {
        if (consumed[i]) continue;

        const lower = lowerWords[i];

        // Guards
        if (/^\d+$/.test(lower)) continue;      // digits only
        if (lower.length <= 2) continue;          // too short
        if (stopSet.has(lower)) continue;         // stop word

        const match = matchSingleWord(rawWords[i], vendors);
        if (match) {
            patches.push({ startIdx: i, endIdx: i, replacement: match.corrected });
            consumed[i] = true;
        }
    }

    // ── Rebuild the output string applying patches ──
    if (patches.length === 0) {
        return text; // nothing changed
    }

    // Sort patches by startIdx so we process left to right
    patches.sort((a, b) => a.startIdx - b.startIdx);

    const result = [];
    let cursor = 0;

    for (const patch of patches) {
        // Add any words before this patch unchanged
        while (cursor < patch.startIdx) {
            result.push(rawWords[cursor]);
            cursor++;
        }
        // Add the corrected vendor name
        result.push(patch.replacement);
        cursor = patch.endIdx + 1;
    }

    // Add any remaining words
    while (cursor < rawWords.length) {
        result.push(rawWords[cursor]);
        cursor++;
    }

    return result.join(' ');
}

module.exports = { correctText, buildVendorList };