/**
 * Structural Matcher - Extracts parameters using the compiled structural index
 */
const fs = require('fs');
const path = require('path');

class StructuralMatcher {
    constructor() {
        this.indexPath = path.join(__dirname, '../data/compiled_index.json');
        this.index = null;
        this.initialized = false;
    }

    _init() {
        if (this.initialized) return;
        try {
            if (fs.existsSync(this.indexPath)) {
                this.index = JSON.parse(fs.readFileSync(this.indexPath, 'utf8'));
                // Convert string regexes back to RegExp objects
                for (const intent in this.index) {
                    this.index[intent] = this.index[intent].map(item => ({
                        ...item,
                        regexObj: new RegExp(item.regex, 'i')
                    }));
                }
                this.initialized = true;
                // console.log(`[StructuralMatcher] Initialized with ${Object.keys(this.index).length} intents`);
            } else {
                console.error(`[StructuralMatcher] Index file not found at ${this.indexPath}`);
            }
        } catch (err) {
            console.error('[StructuralMatcher] Initialization error:', err);
        }
    }

    findMatches(text, candidateIntents = []) {
        this._init();
        if (!this.index) return [];

        const results = [];
        const cleanText = text.trim();

        // If candidateIntents is empty, search all intents in the index
        const intentsToSearch = (candidateIntents && candidateIntents.length > 0)
            ? candidateIntents
            : Object.keys(this.index);

        for (const intentName of intentsToSearch) {
            const patternSet = this.index[intentName];
            if (!patternSet) continue;

            for (const item of patternSet) {
                const match = cleanText.match(item.regexObj);
                if (match) {
                    // Calculate a simple coverage score
                    // length of original template minus tags vs text length
                    const templateBaseLength = item.template.replace(/\[[a-z_]+\]/g, '').length;
                    const confidence = templateBaseLength / cleanText.length;

                    results.push({
                        intentName,
                        template: item.template,
                        groups: match.groups,
                        confidence
                    });
                }
            }
        }

        // Sort by confidence / specificity (longer templates first)
        return results.sort((a, b) => b.confidence - a.confidence);
    }
}

module.exports = new StructuralMatcher();
