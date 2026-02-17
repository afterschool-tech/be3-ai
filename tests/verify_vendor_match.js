const { normalizeVendor } = require("../src/utils/normalization");
const { VENDORS } = require("../src/context/storeContext");

function testNormalization() {
    console.log("--- Vendor Normalization Test ---");

    const testCases = [
        { input: "Tayes Home Decor", expected: "Taye's Home Decor" },
        { input: "Tayes", expected: "Taye's Home Decor" },
        { input: "Taye's", expected: "Taye's Home Decor" },
        { input: "Dareymi", expected: "Dareymi" },
        { input: "Bola Foods", expected: "Bola Foods" },
        { input: "something else", expected: "something else" }
    ];

    let passed = 0;
    testCases.forEach(tc => {
        const result = normalizeVendor(tc.input);
        const isMatch = result === tc.expected;
        if (isMatch) passed++;

        console.log(`Input: "${tc.input}" -> Result: "${result}" [${isMatch ? "✅ PASS" : "❌ FAIL"}]`);
    });

    console.log(`\nSummary: ${passed}/${testCases.length} passed.`);

    if (passed === testCases.length) {
        console.log("✨ All vendor normalization tests passed!");
    } else {
        process.exit(1);
    }
}

testNormalization();
