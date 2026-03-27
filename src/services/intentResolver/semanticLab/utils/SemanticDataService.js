const fs = require('fs');
const path = require('path');
const { queryAI } = require('../../../../core/hfAiService');

class SemanticDataService {
    constructor(benchPath) {
        this.benchPath = benchPath;
        this.bench = this._loadBench();
        this.rateLimitDelay = 1500; // ms between API calls
    }

    _loadBench() {
        if (fs.existsSync(this.benchPath)) {
            try {
                const raw = JSON.parse(fs.readFileSync(this.benchPath, 'utf8'));
                // Migrate old flat structure to metadata structure if needed
                return this._migrateStructure(raw);
            } catch (e) {
                console.warn(`[SemanticDataService] Error loading ${this.benchPath}, starting fresh.`);
            }
        }
        return {};
    }

    _migrateStructure(raw) {
        const migrated = {};
        for (const [key, val] of Object.entries(raw)) {
            if (Array.isArray(val)) {
                migrated[key] = {
                    variations: val,
                    metadata: { runs: 1, last_updated: new Date().toISOString() }
                };
            } else {
                migrated[key] = val;
            }
        }
        return migrated;
    }

    save() {
        fs.writeFileSync(this.benchPath, JSON.stringify(this.bench, null, 2));
    }

    /**
     * Get the average number of runs across all active items to determine "parity".
     */
    getAverageRuns() {
        const items = Object.values(this.bench);
        if (items.length === 0) return 0;
        const total = items.reduce((sum, item) => sum + (item.metadata?.runs || 0), 0);
        return Math.floor(total / items.length);
    }

    /**
     * Generate variations for a specific item (Intent or Clause).
     */
    async generateVariations(key, config, targetCount = 50) {
        console.log(`\n📂 [Generating] ${key} (Current runs: ${this.bench[key]?.metadata?.runs || 0})...`);

        const existingVariations = new Set(this.bench[key]?.variations || []);
        const contextHint = Array.from(existingVariations).slice(-10).join(', ');

        const isClause = config.type === 'Attribute Clause';
        const isFacet = config.type === 'Attribute Facet';

        const taskDescription = isClause
            ? `Generate ${targetCount} NEW, UNIQUE, and HIGHLY DIVERSE short descriptors (1-2 words, adjectives, or slang terms) that a user might use to imply this attribute.`
            : isFacet
                ? `Generate ${targetCount} NEW, UNIQUE, and HIGHLY DIVERSE nouns, labels, or technical terms that a user might use to refer to this attribute name.`
                : `Generate ${targetCount} NEW, UNIQUE, and HIGHLY DIVERSE ways a user might express this ${config.type || 'intent/query'}.`;

        const guidelines = isClause
            ? `1. Focus purely on the ADJECTIVE or DESCRIPTOR (e.g. if the attribute is "affordable", generate "budget", "cheap", "wallet-friendly").
2. DO NOT include category names (no "cheap laptop", just "cheap").
3. Include diverse slang and formal synonyms.
4. DO NOT repeat existing examples.`
            : isFacet
                ? `1. Focus on NOUN SYNONYMS and TECHNICAL TERMS (e.g. if the attribute is "storage", generate "capacity", "memory", "disk space", "ROM").
2. Include both formal industry terms and common user slang.
3. DO NOT repeat existing examples.`
                : `1. Include diverse slang, highly formal language, social noise, and implied needs.
2. VARY the sentence structure significantly (e.g. questions, commands, fragments).
3. DO NOT repeat any existing examples.
4. DO NOT include actual product names, use [product] as a placeholder.`;

        const prompt = `You are a training data generator for an E-commerce AI.
Entity Type: "${config.type || 'Intent'}"
Key: "${key}"
Description: "${config.description || ''}"
Keywords/Seeds: ${config.keywords ? config.keywords.join(', ') : ''}
${contextHint ? '\nExisting examples (DO NOT REPEAT): ' + contextHint : ''}

TASK: ${taskDescription}
GUIDELINES:
${guidelines}
5. Return a JSON array of strings ONLY.`;

        try {
            const response = await queryAI([
                { role: 'system', content: 'You are a high-speed JSON generator outputting string arrays.' },
                { role: 'user', content: prompt }
            ], 2000, 0.9, 3, { response_format: { type: "json_object" } });

            let newVariations = [];
            try {
                const parsed = JSON.parse(response);
                newVariations = Array.isArray(parsed) ? parsed : (parsed.variations || parsed.examples || Object.values(parsed)[0]);
            } catch (e) {
                const match = response.match(/\[.*\]/s);
                if (match) newVariations = JSON.parse(match[0]);
            }

            if (Array.isArray(newVariations)) {
                if (!this.bench[key]) {
                    this.bench[key] = { variations: [], metadata: { runs: 0, last_updated: null } };
                }

                let addedCount = 0;
                newVariations.forEach(v => {
                    const cleanV = v.toLowerCase().trim();
                    if (!existingVariations.has(cleanV) && cleanV.length > 2) {
                        existingVariations.add(cleanV);
                        addedCount++;
                    }
                });

                this.bench[key].variations = Array.from(existingVariations);
                this.bench[key].metadata.runs += 1;
                this.bench[key].metadata.last_updated = new Date().toISOString();

                console.log(`   ✅ Added ${addedCount} new unique variations. (Total: ${existingVariations.size}, Runs: ${this.bench[key].metadata.runs})`);
                this.save();
                return true;
            }
        } catch (error) {
            console.error(`   ❌ API Error for ${key}:`, error.message);
        }
        return false;
    }

    /**
     * Synchronize all items to a target run count.
     */
    async syncAll(configs, targetRuns) {
        console.log(`\n🔄 [Sync] Target Parity: ${targetRuns} runs per item.`);

        for (const [key, config] of Object.entries(configs)) {
            const currentRuns = this.bench[key]?.metadata?.runs || 0;

            if (currentRuns < targetRuns) {
                const runsNeeded = targetRuns - currentRuns;
                console.log(`\n⏳ [Parity] Catching up "${key}": ${runsNeeded} runs behind.`);

                for (let i = 0; i < runsNeeded; i++) {
                    await this.generateVariations(key, config);
                    // Rate limiting
                    await new Promise(resolve => setTimeout(resolve, this.rateLimitDelay));
                }
            }
        }
    }

    /**
     * Hunt down and remove highly similar variations (Fuzzy Deduplication).
     * This prevents the "Diluted Vibe" problem.
     * @param {number} threshold - Similarity threshold (0 to 1, default 0.9)
     */
    async pruneRepetitions(threshold = 0.9) {
        console.log(`\n🧹 [Pruning] Starting fuzzy deduplication (Threshold: ${threshold})...`);
        const natural = require('natural');

        try {
            for (const [key, item] of Object.entries(this.bench)) {
                const benchSamples = item.variations || [];
                const originalCount = benchSamples.length;
                if (originalCount < 2) continue;

                process.stdout.write(`   📂 Cleaning "${key}" (${originalCount} variations)... `);

                const unique = [];
                for (const variation of benchSamples) {
                    const vLower = variation.toLowerCase();
                    // Check if any item already in 'unique' is too similar
                    const isRepetitive = unique.some(u => natural.DiceCoefficient(vLower, u.toLowerCase()) > threshold);

                    if (!isRepetitive) {
                        unique.push(variation);
                    }
                }

                const removed = originalCount - unique.length;
                item.variations = unique;
                process.stdout.write(removed > 0 ? `✅ Removed ${removed}.\n` : `✨ Already clean.\n`);
            }
            this.save();
        } catch (error) {
            console.error('\n❌ Pruning failed:', error.message);
            throw error;
        }
    }
}

module.exports = SemanticDataService;
