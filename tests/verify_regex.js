// Verification Script for ID Regex
const idPattern = /([\*_]*\s*\(ID[:\s]\s*[a-z0-9-]*\)\s*[\*_]*|[\*_]*\s*\(Item:\s*[a-z0-9-]*\)\s*[\*_]*|[\*_]*\s*\(#[a-z0-9-]+\)\s*[\*_]*|[\*_]*\s*\([a-z0-9-]{8,}\)\s*[\*_]*|[\*_]*\s*#[a-z0-9-]{8,}\s*[\*_]*)/gi;

const testCases = [
    "Product A (#12345678)",
    "Product B (ID: 62d41fb1-384a-4f22-9528-fa75b44234a5)",
    "Product Space ID (ID 62d41fb1-384a-4f22-9528-fa75b44234a5)",
    "Product C (Item: 987654321)",
    "Order #12345678",
    "Just a normal text (with parentheses)",
    "Empty ID should go: (ID: )",
    "Formatted Empty ID: *(ID: )*",
    "Formatted UUID: _(ID: abcdef123456)_",
    "Short id (#123) should stay? No, min chars logic applies to bare ones mostly"
];

console.log("--- Regex Verification ---");
testCases.forEach(test => {
    const stripped = test.replace(idPattern, '[STRIPPED]');
    console.log(`Original: "${test}"`);
    console.log(`Stripped: "${stripped}"`);
    console.log("---");
});
