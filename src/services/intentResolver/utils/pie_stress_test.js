const fs = require('fs');
const { extractProductIntel } = require('./productIntelExtractor');

const TEST_CASES = [
    {
        name: "Nested Adjectives (Recognized + Unknown)",
        text: "show me cheap used iphone",
        entities: [
            { type: 'clause', value: 'cheap', clauseId: 'price_low', wordIndices: [2] },
            { type: 'category', value: 'iphone', id: 'cat_phones', wordIndices: [4], consumedWordIndices: [4] }
        ],
        expected: "used iphone",
        description: "Verify that 'cheap' is dropped (clause) but 'used' is kept (unknown trait)."
    },
    {
        name: "Semantic Boundary Breach (The 'to' Failure)",
        text: "do you something similar to iphone12pro",
        entities: [
            { type: 'resolved_product', value: 'Iphone 12 pro', productId: '55f3c6ea-a10c-40fd-9093-60a6982bf2eb', wordIndices: [5] }
        ],
        expected: "iphone12pro",
        description: "Tests if 'to' acts as a wall. Current failure includes 'something similar'."
    },
    {
        name: "Multi-Brand Collision ('like' Boundary)",
        text: "samsung s24 like iphone",
        entities: [
            { type: 'brand', value: 'samsung', wordIndices: [0], consumedWordIndices: [0] },
            { type: 'category', value: 'iphone', id: 'cat_phones', wordIndices: [3], consumedWordIndices: [3] }
        ],
        expected: "samsung s24",
        description: "Ensures 'like' acts as a boundary so 'iphone' doesn't attach to 'samsung s24'."
    },
    {
        name: "2-Word Proximity Rule",
        text: "iphone with a very very very long screen",
        entities: [
            { type: 'category', value: 'iphone', id: 'cat_phones', wordIndices: [0], consumedWordIndices: [0] }
        ],
        expected: "iphone",
        description: "Tests if PIE correctly ignores 'long screen' because it's > 2 words from 'iphone'."
    },
    {
        name: "Technical Specs & Units (GLUE Capture)",
        text: "laptop with 16gb ram and 1tb ssd",
        entities: [
            { type: 'category', value: 'laptop', id: 'cat_laptops', wordIndices: [0], consumedWordIndices: [0] }
        ],
        expected: "laptop 16gb ram 1tb ssd",
        description: "Checks if Alphanumeric 'GLUE' (levels 3) like 16gb, 1tb are captured."
    },
    {
        name: "Possessive/Noise Filter",
        text: "it's my brother's used iphone",
        entities: [
            { type: 'category', value: 'iphone', id: 'cat_phones', wordIndices: [4], consumedWordIndices: [4] }
        ],
        expected: "used iphone",
        description: "Checks if 'my' and 'brother's' are filtered out as noise."
    },
    {
        name: "Noise Keyword Leakage",
        text: "give me a guess for a good phone",
        entities: [
            { type: 'category', value: 'phone', id: 'cat_phones', wordIndices: [7], consumedWordIndices: [7] }
        ],
        expected: "phone",
        description: "Current 'vulnerability' test for 'guess' and 'good' which might leak."
    },
    {
        name: "Saturation Guard (Redundancy)",
        text: "show me phones",
        entities: [
            { type: 'category', value: 'phones', id: 'cat_phones', wordIndices: [2], consumedWordIndices: [2] }
        ],
        expected: null,
        description: "Should return null because 'phones' is just the category."
    },
    {
        name: "Model Suffix Chain",
        text: "iphone 15 pro max case",
        entities: [
            { type: 'category', value: 'iphone', wordIndices: [0], consumedWordIndices: [0] },
            { type: 'category', value: 'case', wordIndices: [4], consumedWordIndices: [4] }
        ],
        expected: "iphone 15 pro max case",
        description: "Checks if multiple model descriptors (pro, max) are kept between two anchors."
    },
    {
        name: "Comparison Split-Intent",
        text: "iphone 13 versus samsung s23",
        intentName: "product_compare",
        entities: [
            { type: 'category', value: 'iphone', wordIndices: [0] },
            { type: 'brand', value: 'samsung', wordIndices: [3] }
        ],
        expected: ["iphone 13", "samsung s23"],
        description: "Verifies the segmenter correctly splits the query into two distinct products."
    }
];

const excludeSet = new Set([
    'show', 'me', 'i', 'need', 'want', 'give', 'list', 'lists', 'under', 'below', 'for', 'the', 'a', 'an', 'any', 'some',
    'compare', 'comparison', 'difference', 'between', 'versus', 'vs', 'v/s',
    'and', 'with', 'by', 'at', 'on', 'of', 'in',
    'but', 'still', 'like', 'also', 'just', 'very', 'really',
    'what', 'is', 'it', 'tell', 'about', 'those', 'these', 'this', 'that', 'its',
    'yes', 'no', 'ok', 'okay', 'cool', 'thanks', 'thank', 'please', 'hi', 'hello', 'hey', 'ya', 'yeah', 'yup', 'nope', "i'm",
    'to', 'my', 'your', 'get', 'based', 'own', 'which', 'one', 'two',
    'can', 'you', 'could', 'would', 'will', 'shall', 'should', 'may', 'might',
    'so', "i'll", 'ill', 'do', 'does', 'did', 'doing',
    'have', 'has', 'had', 'having',
    'advice', 'advise', 'recommend', 'recommendation', 'suggest', 'suggestion', 'guidance', 'help',
    'product', 'products', 'item', 'items', 'gadget', 'gadgets',
    'something', 'similar', 'guess', 'good', 'best',
    'looking', 'look', 'find', 'search', 'browse', 'explore', 'discover', 'view', 'see', 'seek',
    'buy', 'purchase', 'order', 'grab', 'add', 'remove', 'delete', 'update', 'change', 'modify'
]);

let report = "# PIE Stress Test Report\n\n";
report += "This report evaluates the **current (baseline)** PIE implementation against 10 hard edge cases.\n\n";
report += "| Case | Query | Expected | Actual | Result | Potential Vulnerability |\n";
report += "| :--- | :--- | :--- | :--- | :--- | :--- |\n";

TEST_CASES.forEach((tc, i) => {
    const results = extractProductIntel({
        text: tc.text,
        entities: tc.entities,
        intentName: tc.intentName || 'product_search',
        excludeSet
    });

    const actual = results.length > 1 ? results.map(r => r.name) : (results[0]?.name || null);
    const passed = JSON.stringify(actual) === JSON.stringify(tc.expected);

    report += `| ${i+1} | "${tc.text}" | ${JSON.stringify(tc.expected)} | ${JSON.stringify(actual)} | ${passed ? '✅' : '❌'} | ${tc.description} |\n`;
});

fs.writeFileSync('/tmp/pie_report.md', report);
console.log('Report written to /tmp/pie_report.md');
