const { extractProductIntel } = require('./productIntelExtractor');
const FILLERS = new Set(['i', 'want', 'to', 'show', 'me', 'compare', 'with', 'and', 'the', 'a', 'an', 'latest']);

const scenarios = [
    {
        name: "Scenario 4: Multi-Product (Stripping Traits)",
        text: "compare a cheap infinix phone and the latest samsung phone",
        entities: [
            { type: 'clause', value: 'cheap', clauseId: 'budget', wordIndices: [2] },
            { type: 'clause', value: 'latest', clauseId: 'new_arrival', wordIndices: [7] },
            { type: 'category', id: 'phones', value: 'phone', wordIndices: [4, 9] },
            { type: 'brand', value: 'Infinix', wordIndices: [3] },
            { type: 'brand', value: 'Samsung', wordIndices: [8] }
        ],
        intent: 'product_compare'
    },
    {
        name: "Scenario 5: Brand-Aware (Keep Trait if Brand)",
        text: "show me cheap monday jeans",
        entities: [
            { type: 'brand', value: 'Cheap Monday', wordIndices: [2, 3] },
            { type: 'category', id: 'jeans', value: 'jeans', wordIndices: [4] }
        ],
        intent: 'product_search'
    },
    {
        name: "Scenario 6: Naked Category (Squeeze Prevention)",
        text: "show me a good cheap iphone you have",
        entities: [
            { type: 'clause', value: 'cheap', clauseId: 'budget', wordIndices: [4] },
            { type: 'category', id: 'iphones', value: 'iphone', wordIndices: [5] }
        ],
        intent: 'product_search'
    }
];

scenarios.forEach(s => {
    console.log(`TEST: ${s.name}`);
    const results = extractProductIntel({ text: s.text, entities: s.entities, intentName: s.intent, excludeSet: FILLERS });
    if (results.length === 0) {
        console.log(`  RESULT: EMPTY (Suppressed by Saturation Guard)`);
    } else {
        results.forEach(p => console.log(`  RESULT NAME: "${p.name}" | INTEL CLAUSES: ${JSON.stringify(p.intel.clauses)}`));
    }
});
