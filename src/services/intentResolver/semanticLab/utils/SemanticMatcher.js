const natural = require('natural');
const fs = require('fs');
const path = require('path');

/**
 * Shared Semantic Engine
 * Encapsulates TF-IDF and Dice Coefficient math.
 */
class SemanticMatcher {
    constructor(benchPath, label = 'General') {
        this.benchPath = benchPath; // Can be a file OR a directory
        this.label = label;
        this.benchData = {}; // Initialize as empty object for aggregation
        this.tfidf = new natural.TfIdf();
        this.isLoaded = false;

        this._load();
    }

    _load() {
        if (!fs.existsSync(this.benchPath)) {
            console.warn(`[SemanticMatcher:${this.label}] Path not found: ${this.benchPath}`);
            return;
        }

        try {
            const stats = fs.statSync(this.benchPath);

            if (stats.isDirectory()) {
                // Aggregated Loading (Decentralized)
                const intentsDir = this.benchPath;
                const intentFolders = fs.readdirSync(intentsDir);

                for (const folder of intentFolders) {
                    const benchFile = path.join(intentsDir, folder, 'bench.json');
                    if (fs.existsSync(benchFile)) {
                        try {
                            const data = JSON.parse(fs.readFileSync(benchFile, 'utf8'));
                            Object.assign(this.benchData, data);
                        } catch (e) {
                            console.warn(`[SemanticMatcher:${this.label}] Failed to read ${folder}/bench.json:`, e.message);
                        }
                    }
                }
                console.log(`📡 [SemanticMatcher:${this.label}] Aggregated ${Object.keys(this.benchData).length} intent benches from directory.`);
            } else {
                // Single File Loading (Legacy/Standard)
                this.benchData = JSON.parse(fs.readFileSync(this.benchPath, 'utf8'));
                console.log(`📡 [SemanticMatcher:${this.label}] Loaded single bench: ${Object.keys(this.benchData).length} clusters.`);
            }

            // Index each cluster
            for (const [id, entry] of Object.entries(this.benchData)) {
                const variations = entry.variations || [];
                if (variations.length > 0) {
                    this.tfidf.addDocument(variations.join(' '), id);
                }
            }
            this.isLoaded = true;
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

            // Normalize by corpus size so larger benches don't dominate smaller, precise ones.
            // A bench with 300 variations shouldn't automatically outscore one with 80.
            const sizeNorm = Math.log1p(50) / Math.log1p(benchSamples.length); // anchored at 50 variations
            const normalizedVectorBias = Math.log1p(vectorScore) * sizeNorm;

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
                    boost: (maxSimilarity * 2.5) + (normalizedVectorBias * 1.5)
                });
            }
        }

        return matches.sort((a, b) => (b.boost) - (a.boost));
    }
}

module.exports = SemanticMatcher;
