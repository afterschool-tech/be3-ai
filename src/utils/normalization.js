/**
 * Normalization Utility
 * Shared logic for resolving user-provided strings to store entities.
 */

const { CATEGORIES, VENDORS } = require('../context/storeContext');

/**
 * Normalizes a category string (label, slug, or breadcrumb) to a valid Category ID.
 * @param {string} cat - The input category string.
 * @param {Object} [context] - Optional categories context.
 * @param {boolean} [exactMatchOnly=false] - If true, only returns IDs for exact label/slug matches.
 * @returns {string|null} - The Category UUID or null.
 */
function normalizeCategory(cat, context = null, exactMatchOnly = false) {
    if (!cat) return null;
    const cats = context || CATEGORIES;
    let catLower = cat.trim().toLowerCase();

    // Guard: avoid partial-matching extremely short tokens (e.g., "in", "on", "at")
    // which can accidentally match inside real category labels ("All in one PCs").
    // Still allow exact-match resolution (keys/labels/slugs/ids).
    const isTooShortForPartial = catLower.length < 3;

    // 1. Handle breadcrumbs
    if (catLower.includes('>')) {
        catLower = catLower.split('>').pop().trim();
    }

    // 2. Direct match with key
    if (cats[catLower]) return cats[catLower].id;

    // 3. Find all potential candidate categories
    const candidates = Object.values(cats).map(c => {
        if (!c || (!c.label && !c.slug)) return null;
        let score = 0;
        const labelLower = (c.label || '').toLowerCase();
        const slugLower = (c.slug || '').toLowerCase();

        // Exact match (highest priority)
        if (c.id === catLower || slugLower === catLower || labelLower === catLower) {
            score = 100;
        }
        // Partial match with word boundary check
        else if (!exactMatchOnly && !isTooShortForPartial) {
            const regex = new RegExp(`\\b${catLower}\\b`, 'i');
            if (regex.test(labelLower) || regex.test(slugLower)) {
                score = 10;
            }
        }

        if (score === 0) return null;

        // --- TIE BREAKERS & SMART BOOSTS ---

        // Boost populated categories (CRITICAL: prevents picking empty niches)
        if ((c.total_count || c.product_count) > 0) score += 50;

        // Boost broad categories (Top level parents)
        if (!c.parent_id) score += 20;

        // Boost for label similarity (e.g. "laptops" vs "business laptops")
        // If the user word is exactly the label, it's better than if it's just part of it
        if (labelLower === catLower) score += 30;

        return { id: c.id, score };
    }).filter(Boolean);

    if (candidates.length === 0) return null;

    // Sort by score descending
    candidates.sort((a, b) => b.score - a.score);

    return candidates[0].id;
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
    const vendorLower = vendor.trim().toLowerCase();

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
