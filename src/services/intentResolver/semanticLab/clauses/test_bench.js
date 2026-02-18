/**
 * Clause Bench Tester
 * Tests how words "vibe" with the keyword bench.
 * Usage: node src/services/intentResolver/semanticLab/clauses/test_bench.js "your adjective"
 */
const path = require('path');
const SemanticMatcher = require('../utils/SemanticMatcher');

const BENCH_FILE = path.join(__dirname, 'clause_bench.json');
const matcher = new SemanticMatcher(BENCH_FILE, 'Clauses');

async function test() {
    const input = process.argv[2];
    if (!input) {
        console.log('Usage: node test_bench.js "word"');
        return;
    }

    console.log(`🔎 Testing Vibe for: "${input}"...`);

    if (!matcher.isLoaded) {
        console.error('❌ Matcher not loaded. Check bench file.');
        return;
    }

    const matches = matcher.findMatches(input);

    if (matches.length === 0) {
        console.log('❌ No semantic match found.');
        return;
    }

    console.log('\n🏆 TOP MATCHES:');
    matches.slice(0, 5).forEach((m, i) => {
        const status = m.similarity > 0.6 ? '✅ (Strong)' : (m.similarity > 0.3 ? '⚠️ (Moderate)' : '❓ (Weak)');
        console.log(`${i + 1}. ${m.id.padEnd(20)} | Vibe: ${(m.similarity * 100).toFixed(1)}% | Boost: ${m.boost.toFixed(2)} ${status}`);
    });
}

test().catch(console.error);
