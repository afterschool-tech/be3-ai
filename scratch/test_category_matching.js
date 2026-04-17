const { normalizeCategory } = require('../src/utils/normalization');
const { CATEGORIES } = require('../src/context/storeContext');

const testCases = [
    "son",
    "phone",
    "phones",
    "smartphones",
    "personal",
    "personal care",
    "head",
    "headphones",
    "gift for my son",
    "i need a new phone",
    "show me something for personal care"
];

console.log("====================================================");
console.log("CATEGORY MATCHING TIER TEST");
console.log("====================================================");
console.log(`${String("Input").padEnd(30)} | ${String("Best Match").padEnd(30)} | ${String("Tier").padEnd(10)} | Details`);
console.log("-".repeat(110));

testCases.forEach(input => {
    // PASS semanticContext: { available: true } to simulate the Transformer being UP
    // This disables Alias matching, forcing reliance on Lexical Tiers.
    const result = normalizeCategory(input, CATEGORIES, false, { 
        returnMeta: true, 
        debug: false,
        semanticContext: { available: true } 
    });
    
    if (result && result.meta) {
        const meta = result.meta;
        const catId = result.id;
        const cat = Object.values(CATEGORIES).find(c => c.id === catId);
        const matchLabel = cat ? cat.label : "Unknown";
        const tier = meta.lexTier || meta.layer;
        const details = meta.match ? `${meta.match.type} (${meta.match.variant} -> ${meta.match.token || ''})` : "N/A";
        
        console.log(`${input.padEnd(30)} | ${matchLabel.padEnd(30)} | ${String(tier).padEnd(10)} | ${details}`);
    } else {
        console.log(`${input.padEnd(30)} | No Match`.padEnd(65) + " | N/A".padEnd(10) + " | N/A");
    }
});
console.log("====================================================");
