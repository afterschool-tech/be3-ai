const fs = require('fs');
const path = require('path');
const resultsPath = path.join(__dirname, 'verification_results.json');
const content = fs.readFileSync(resultsPath, 'utf8');

// The file might contain debug logs from the process, so let's find the results summary
// Matching the ❌ symbol (which might be mangled in terminal output)
const failedMatches = [...content.matchAll(/(?:❌|Ô£û) (.*)\n\s+Input:\s+"(.*)"\n\s+Result:\s+(\{[\s\S]*?\})\n\s+Expected: product="(.*)" hasClauses=(.*)/g)];

console.log('--- FAILED CASES ---');
failedMatches.forEach(match => {
    console.log(`TEST: ${match[1]}`);
    console.log(`Input: ${match[2]}`);
    console.log(`Result: ${match[3]}`);
    console.log(`Expected Product: ${match[4]}`);
    console.log(`Expected hasClauses: ${match[5]}`);
    console.log('--------------------');
});

const summaryMatch = content.match(/Results: (\d+) passed, (\d+) failed out of (\d+)/);
if (summaryMatch) {
    console.log(`\nSUMMARY: ${summaryMatch[0]}`);
}
