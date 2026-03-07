const { extractProductIntel } = require('./productIntelExtractor');

// Mock Exclude Set (Fillers)
const FILLERS = new Set(['i', 'want', 'to', 'show', 'me', 'compare', 'with', 'and', 'the', 'a', 'an', 'latest']);

const testScenarios = [
    {
        name: "1. Basic Search with Category Re-injection",
        text: "show me the latest iphone 16",
        entities: [
            { type: 'category', id: 'iphones', value: 'iphone', wordIndices: [4] }
        ],
        intent: 'product_search'
    },
    {
        name: "2. Comparison with Resolved Intel (Stage 2)",
        text: "compare it with samsung s24",
        entities: [
            { type: "resolved_product", value: "iPhone 15", productId: "uuid-ip15", wordIndices: [1] },
            { type: "brand", value: "Samsung", wordIndices: [3] }
        ],
        intent: 'product_compare'
    },
    {
        name: "3. Complex Brand with Internal Splitter (Soap and Glory)",
        text: "compare soap and glory with dove",
        entities: [
            { type: 'brand', value: 'Soap and Glory', wordIndices: [1, 2, 3] },
            { type: 'brand', value: 'Dove', wordIndices: [5] }
        ],
        intent: 'product_compare'
    },
    {
        name: "4. Multi-Product - Multi-word residuals & attributes (Stripping Trait)",
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
        name: "5. Brand-Aware Segmenting (Keep Trait if part of Pivot)",
        text: "show me cheap monday jeans",
        entities: [
            { type: 'brand', value: 'Cheap Monday', wordIndices: [2, 3] },
            { type: 'category', id: 'jeans', value: 'jeans', wordIndices: [4] }
        ],
        intent: 'product_search'
    }
];

console.log("=== PRODUCT INTEL EXTRACTOR (PIE) TEST SUITE ===\n");

testScenarios.forEach(s => {
    console.log(`SCENARIO: ${s.name}`);
    console.log(`INPUT: "${s.text}"`);
    const results = extractProductIntel({
        text: s.text,
        entities: s.entities,
        intentName: s.intent,
        excludeSet: FILLERS
    });

    results.forEach((p, i) => {
        console.log(`  [Product ${i + 1}]: "${p.name}" (Confidence: ${p.confidence.toFixed(2)}, Resolved: ${p.isResolved})`);
        console.log(`    Intel: Brand=${p.intel.brand || 'None'}, Category=${p.intel.category || 'None'}, ID=${p.intel.resolvedId || 'None'}`);
    });
    console.log("-".repeat(50));
});
