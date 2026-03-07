const { extractProductIntel } = require('../src/services/intentResolver/utils/productIntelExtractor');

const text = "compare iphone 12 pro and dreymobile 16";
const entities = [
    {
        type: 'category',
        value: 'iphone 12 pro',
        id: 'cat_iphone',
        wordIndices: [1, 2, 3],
        consumedWordIndices: [1] // "iphone"
    }
];

const excludeSet = new Set(['compare', 'and']); // 'iphone' would be handled by category logic

console.log("--- PIE FINAL VERIFICATION (UNKNOWN NOUN) ---");
const results = extractProductIntel({
    text,
    entities,
    excludeSet,
    intentName: 'product_compare'
});

console.log("\nPIE RESULTS:", JSON.stringify(results, null, 2));

