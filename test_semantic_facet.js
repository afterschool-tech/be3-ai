const path = require('path');
const SemanticMatcher = require('./src/services/intentResolver/semanticLab/utils/SemanticMatcher');

async function testSemanticMatching() {
    const INTENTS_DIR = path.join(__dirname, 'src/services/intentResolver/semanticLab/intents');
    const matcher = new SemanticMatcher(INTENTS_DIR, 'Intents');

    const testQueries = [
        "what colors of phones do you have?",
        "which storage sizes are available for laptops?",
        "list the brands of i-phone you carry",
        "do you have phone made of titanium?",
        "what is the quality of this [product]?",
        "what gigabytes of phones do you have?",
        "i want to buy a phone"
    ];

    console.log(`📡 [Test] Top Match per Query:\n`);

    for (const query of testQueries) {
        const masked = query.replace(/phone|laptop|i-phone/gi, '[product]');
        const matches = matcher.findMatches(masked);

        if (matches.length > 0) {
            const top = matches[0];
            process.stdout.write(`Q: "${query}" -> Intent: [${top.id}] (Sim: ${top.similarity.toFixed(2)})\n`);
        } else {
            process.stdout.write(`Q: "${query}" -> NO MATCH\n`);
        }
    }
}

testSemanticMatching().catch(console.error);
