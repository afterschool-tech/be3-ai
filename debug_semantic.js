const path = require('path');
const SemanticMatcher = require('./src/services/intentResolver/semanticLab/utils/SemanticMatcher');

async function debugMatching() {
    const INTENTS_DIR = path.join(__dirname, 'src/services/intentResolver/semanticLab/intents');
    const matcher = new SemanticMatcher(INTENTS_DIR, 'Intents');

    const query = "what colors of phones do you have?";
    const masked = "what colors of [product] do you have?";

    console.log(`Query: "${query}"`);
    console.log(`Masked: "${masked}"`);

    const matches = matcher.findMatches(masked);

    console.log(`\nFound ${matches.length} matches. Top 3:`);
    matches.slice(0, 3).forEach((m, i) => {
        console.log(`${i + 1}. [${m.id}] Similarity: ${m.similarity.toFixed(2)}, Boost: ${m.boost.toFixed(2)}`);
    });
}

debugMatching().catch(console.error);
