const natural = require('natural');
const fs = require('fs');

/**
 * Shared Semantic Engine
 * Encapsulates TF-IDF and Dice Coefficient math.
 */
class SemanticMatcher {
    constructor(benchPath, label = 'General') {
        this.benchPath = benchPath;
        this.label = label;
        this.benchData = null;
        this.tfidf = new natural.TfIdf();
        this.isLoaded = false;

        this._load();
    }

    _load() {
        if (!fs.existsSync(this.benchPath)) {
            console.warn(`[SemanticMatcher:${this.label}] Bench file not found: ${this.benchPath}`);
            return;
        }

        try {
            this.benchData = JSON.parse(fs.readFileSync(this.benchPath, 'utf8'));

            // Index each cluster
            for (const [id, entry] of Object.entries(this.benchData)) {
                const variations = entry.variations || [];
                if (variations.length > 0) {
                    this.tfidf.addDocument(variations.join(' '), id);
                }
            }
            this.isLoaded = true;
            console.log(`📡 [SemanticMatcher:${this.label}] Index built for ${Object.keys(this.benchData).length} clusters.`);
        } catch (e) {
            console.error(`[SemanticMatcher:${this.label}] Load error:`, e.message);
        }
    }

    /**
     * Find matches for a given text.
     * @param {string} text - The user input (ideally cleaned/masked)
     * @returns {Array} - List of { id, score, similarity }
     */
    findMatches(text) {
        if (!this.isLoaded || !text) return [];

        // 1. TF-IDF Vector Bias
        const vectorResults = [];
        this.tfidf.tfidfs(text, (i, score, id) => {
            vectorResults.push({ id, vectorScore: score });
        });

        const matches = [];

        // 2. High Precision Pass (Dice)
        for (const [id, entry] of Object.entries(this.benchData)) {
            const benchSamples = entry.variations || [];
            if (!benchSamples.length) continue;

            const vectorMatch = vectorResults.find(r => r.id === id);
            const vectorScore = vectorMatch ? vectorMatch.vectorScore : 0;
            const normalizedVectorBias = Math.log1p(vectorScore);

            // Optimization: Only run Dice if there's some vector signal
            let maxSimilarity = 0;
            if (normalizedVectorBias > 0.02) {
                for (const sample of benchSamples) {
                    const sim = natural.DiceCoefficient(text, sample.toLowerCase());
                    if (sim > maxSimilarity) maxSimilarity = sim;
                    if (maxSimilarity > 0.95) break;
                }
            }

            if (maxSimilarity > 0 || normalizedVectorBias > 0) {
                matches.push({
                    id,
                    vectorScore: normalizedVectorBias,
                    similarity: maxSimilarity,
                    // Generic boost formula
                    boost: (maxSimilarity * 2.5) + (normalizedVectorBias * 1.5)
                });
            }
        }

        return matches.sort((a, b) => (b.boost) - (a.boost));
    }
}

module.exports = SemanticMatcher;
