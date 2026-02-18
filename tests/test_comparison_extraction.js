/**
 * Test Product Comparison Extraction
 * Verifies that the new comparison logic handles both 
 * resolved context IDs and raw name splitting.
 */

const { extractDeterministic } = require('../src/services/intentResolver/pipeline/parameterExtractor');

const mockCandidates = [{ intentName: 'product_compare' }];
const mockStoreContext = {};

const testCases = [
    {
        name: "Resolved IDs from Context",
        text: "Compare the first one and the second one",
        resolutions: [
            { original: "the first one", resolved: "Iphone 12 Pro", productId: "id-123" },
            { original: "the second one", resolved: "iphone 17 pro", productId: "id-456" }
        ],
        expectedProducts: ["id-123", "id-456"]
    },
    {
        name: "Raw Name Splitting (and)",
        text: "Compare Iphone 12 and Galaxy S21",
        resolutions: [],
        expectedProducts: ["iphone 12", "galaxy s21"]
    },
    {
        name: "Raw Name Splitting (vs)",
        text: "iphone 12 vs galaxy s21",
        resolutions: [],
        expectedProducts: ["iphone 12", "galaxy s21"]
    },
    {
        name: "Compare with Resolution (it with)",
        text: "Compare it with iPhone xs max",
        resolutions: [
            { original: "it", resolved: "iphone 17 pro", productId: "id-123" }
        ],
        expectedProducts: ["id-123", "iphone xs max"]
    },
    {
        name: "Mixed Resolved and Raw",
        text: "Compare the first one and Galaxy S21",
        resolutions: [
            { original: "the first one", resolved: "Iphone 12 Pro", productId: "id-123" }
        ],
        expectedProducts: ["id-123", "galaxy s21"]
    },
    {
        name: "Complex Splitting with Verbs",
        text: "What is the difference between iphone 12 and 13 pro",
        resolutions: [],
        expectedProducts: ["iphone 12", "13 pro"]
    },
    {
        name: "Cleaning redundant words",
        text: "Compare show me cheap iphone and expensive pro",
        resolutions: [],
        expectedProducts: ["iphone", "pro"]
    }
];

async function runTests() {
    console.log('🧪 Starting Product Comparison Extraction Tests...\n');
    let passed = 0;

    for (const tc of testCases) {
        process.stdout.write(`Testing: "${tc.name}"... `);
        const extracted = extractDeterministic(tc.text, mockCandidates, mockStoreContext, tc.resolutions);

        const products = extracted.products || [];
        const match = JSON.stringify(products.sort()) === JSON.stringify(tc.expectedProducts.sort());

        if (match) {
            console.log('✅ PASS');
            passed++;
        } else {
            console.log('❌ FAIL');
            console.log(`   Expected: ${JSON.stringify(tc.expectedProducts)}`);
            console.log(`   Got:      ${JSON.stringify(products)}`);
        }
    }

    console.log(`\n📊 Summary: ${passed}/${testCases.length} passed.`);
    if (passed === testCases.length) {
        process.exit(0);
    } else {
        process.exit(1);
    }
}

runTests().catch(err => {
    console.error(err);
    process.exit(1);
});
