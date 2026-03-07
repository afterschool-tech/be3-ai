const { extractProductIntel } = require('../src/services/intentResolver/utils/productIntelExtractor');

const excludeSet = new Set(['show', 'me', 'i', 'need', 'want', 'give', 'list', 'lists', 'under', 'below', 'for', 'the', 'a', 'an', 'any', 'some', 'compare', 'comparison', 'difference', 'between', 'versus', 'vs', 'v/s', 'and', 'with', 'by', 'at', 'on', 'of', 'in', 'but', 'still', 'like', 'also', 'just', 'very', 'really', 'what', 'is', 'it', 'tell', 'about', 'those', 'these', 'this', 'that', 'its', 'yes', 'no', 'ok', 'okay', 'cool', 'thanks', 'thank', 'please', 'hi', 'hello', 'hey', 'ya', 'yeah', 'yup', 'nope', "i'm", 'to', 'my', 'your', 'get', 'based', 'own', 'which', 'one', 'two', 'can', 'you', 'could', 'would', 'will', 'shall', 'should', 'may', 'might', 'so', "i'll", 'ill', 'do', 'does', 'did', 'doing', 'have', 'has', 'had', 'having', 'advice', 'advise', 'recommend', 'recommendation', 'suggest', 'suggestion', 'guidance', 'help', 'product', 'products', 'item', 'items', 'gadget', 'gadgets', 'looking', 'look', 'find', 'search', 'browse', 'explore', 'discover', 'view', 'see', 'seek', 'buy', 'purchase', 'order', 'grab', 'add', 'remove', 'delete', 'update', 'change', 'modify', 'from', 'yesterday', 'brother']);


const testScenarios = [
    {
        name: "Boundary Interruption ('for my')",
        text: "i want to buy a drey mobile t12 for my brother",
        entities: [
            { type: 'action', value: 'buy', wordIndices: [3], consumedWordIndices: [3] },
            { type: 'category', value: 'mobile', wordIndices: [6], consumedWordIndices: [6] }
        ]
    },
    {
        name: "Boundary Interruption ('from')",
        text: "compare iphone 12 pro and samsung s24 from yesterday",
        entities: [
            { type: 'action', value: 'compare', wordIndices: [0], consumedWordIndices: [0] },
            { type: 'category', value: 'iphone 12 pro', wordIndices: [1, 2, 3], consumedWordIndices: [1] },
            { type: 'brand', value: 'samsung', wordIndices: [5], consumedWordIndices: [5] }
        ]
    },
    {
        name: "Proximity Allow (Adjacent unknown)",
        text: "i want cheap dreymobile phone",
        entities: [
            { type: 'clause', value: 'cheap', wordIndices: [2] },
            { type: 'category', value: 'phone', wordIndices: [4], consumedWordIndices: [4] }
        ]
    }
];

console.log("=== PROXIMITY & BOUNDARY TEST SUITE ===\n");

testScenarios.forEach(s => {
    console.log(`SCENARIO: ${s.name}`);
    console.log(`INPUT: "${s.text}"`);
    const results = extractProductIntel({
        text: s.text,
        entities: s.entities,
        intentName: s.name.startsWith('Boundary Interruption (\'from\')') ? 'product_compare' : 'product_search',
        excludeSet
    });

    results.forEach((p, i) => {
        console.log(`  [Product ${i + 1}]: "${p.name}"`);
    });
    console.log("-".repeat(50));
});
