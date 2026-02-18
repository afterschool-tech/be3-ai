/**
 * Test Category Discovery Logic
 * Verifies that word boundaries and n-gram scanning work as expected.
 */

const { extractDeterministic } = require('../src/services/intentResolver/pipeline/parameterExtractor');
const { CATEGORIES } = require('../src/context/storeContext');

const mockStoreContext = { CATEGORIES };
const mockCandidates = [{ intentName: 'product_search' }];

const testCases = [
    {
        name: "Correct Category Match (Monogram)",
        text: "show me smartphones",
        expectedCategory: "7b8b5bb4-7878-4203-a550-a0941e1e3eb9", // Smartphones UUID
        expectedProductName: undefined
    },
    {
        name: "Correct Category Match (Bigram)",
        text: "I want android phones",
        expectedCategory: "5cba5153-0772-450a-b8b7-8a4fa532ecc1", // Android Phones UUID
        expectedProductName: undefined
    },
    {
        name: "The 'Me' Bug Fix (Word Boundary)",
        text: "show me cheap smartphones",
        expectedCategory: "7b8b5bb4-7878-4203-a550-a0941e1e3eb9", // Smartphones UUID
        expectedProductName: undefined // "me" should be ignored, "smartphones" should be stripped
    },
    {
        name: "Product Name with Category Strip",
        text: "red smartphones under 200",
        expectedCategory: "7b8b5bb4-7878-4203-a550-a0941e1e3eb9",
        expectedProductName: "red"
    },
    {
        name: "Graceful Degradation (No Category)",
        text: "show me some custom item",
        expectedCategory: undefined,
        expectedProductName: "custom item"
    },
    {
        name: "Partial Match Prevention (Substrings)",
        text: "show me some gaming gear",
        expectedCategory: "63efd70e-2daf-46f9-b801-d9da53209930", // Gaming UUID
        expectedProductName: "gear"
    }
];

async function runTests() {
    console.log('🧪 Starting Category Discovery Tests...\n');
    let passed = 0;

    for (const tc of testCases) {
        process.stdout.write(`Testing: "${tc.text}"... `);
        const extracted = extractDeterministic(tc.text, mockCandidates, mockStoreContext);

        const catMatch = extracted.category === tc.expectedCategory;
        const prodMatch = extracted.product_name === tc.expectedProductName;

        if (catMatch && prodMatch) {
            console.log('✅ PASS');
            passed++;
        } else {
            console.log('❌ FAIL');
            if (!catMatch) console.log(`   Expected Category: ${tc.expectedCategory}, Got: ${extracted.category}`);
            if (!prodMatch) console.log(`   Expected Product Name: ${tc.expectedProductName}, Got: ${extracted.product_name}`);
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
