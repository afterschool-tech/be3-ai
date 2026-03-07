const { extractProductIntel, LEVELS } = require('./productIntelExtractor');

const text = "iphone 12 pro";
const entities = [
    { type: 'category', value: 'iphone', id: 'iphones', wordIndices: [0] }
];
const excludeSet = new Set(['show', 'iphone']); // "iphone" is excluded because it's a category

console.log("--- DEBUG PIE ---");
const results = extractProductIntel({
    text,
    entities,
    intentName: 'product_search',
    excludeSet
});

if (results.length > 0) {
    console.log(`RESULT NAME: "${results[0].name}"`);
} else {
    console.log("RESULT: EMPTY");
}
