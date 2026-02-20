/**
 * Deep Probe V2 - Full Candidate Extraction Test
 */
const { extractParameters } = require('../src/services/intentResolver/pipeline/parameterExtractor');
const storeContext = require('../src/context/storeContext');

async function dryRun(text) {
    console.log(`\nProbe: "${text}"`);
    const candidates = [
        { intentName: 'vendor_products', matchedKeywords: [], keywordScore: 0.5 },
        { intentName: 'vendor_contact', matchedKeywords: [], keywordScore: 0.5 },
        { intentName: 'product_search', matchedKeywords: [], keywordScore: 0.5 }
    ];

    const mockAi = async () => JSON.stringify({});

    const params = await extractParameters(text, candidates, mockAi, storeContext);
    console.log(`Result: ${JSON.stringify(params, null, 2)}`);
}

dryRun("i need Dareymi contact").catch(console.error);
dryRun("i need phones from Dareymi").catch(console.error);
