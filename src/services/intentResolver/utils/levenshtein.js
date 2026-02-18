/**
 * Levenshtein Distance
 * Calculates the minimum number of single-character edits
 * (insertions, deletions, substitutions) to transform one string into another.
 */

function levenshtein(a, b) {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    const matrix = [];

    for (let i = 0; i <= b.length; i++) {
        matrix[i] = [i];
    }
    for (let j = 0; j <= a.length; j++) {
        matrix[0][j] = j;
    }

    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            const cost = a[j - 1] === b[i - 1] ? 0 : 1;
            matrix[i][j] = Math.min(
                matrix[i - 1][j] + 1,       // deletion
                matrix[i][j - 1] + 1,       // insertion
                matrix[i - 1][j - 1] + cost  // substitution
            );
        }
    }

    return matrix[b.length][a.length];
}

/**
 * Find the closest match for a word in a dictionary.
 * Returns { match, distance } or null if no match within maxDistance.
 */
function findClosest(word, dictionary, maxDistance = 2) {
    let closest = null;
    let minDist = Infinity;

    for (const entry of dictionary) {
        const dist = levenshtein(word.toLowerCase(), entry.toLowerCase());
        if (dist < minDist && dist <= maxDistance) {
            minDist = dist;
            closest = { match: entry, distance: dist };
        }
    }

    return closest;
}

module.exports = { levenshtein, findClosest };
