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
        else if (!exactMatchOnly) {
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

module.exports = {
    normalizeCategory,
    normalizeVendor
};
