const { getLogicSystemPrompt, getPersonalityRewritePrompt } = require('../src/core/personalities');

const mockContext = "Store Context: 25 products available.";
const mockResults = JSON.stringify([{ product: "Test Product", id: "123", price: 100 }], null, 2);
const mockSafeResponse = "Found Test Product (#123) for $100.";

console.log("=== LOGIC PROMPT ===");
console.log(getLogicSystemPrompt(mockContext, mockResults));

console.log("\n=== PERSONALITY PROMPT ===");
console.log(getPersonalityRewritePrompt(mockSafeResponse));
