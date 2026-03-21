const intelliSense = require('./src/services/intelliSense');
const { queryAI } = require('./src/core/hfAiService');

/**
 * Mock aiQueryFn that uses the real project AI service
 */
async function aiQueryFn(prompt, maxTokens, temperature, topP, responseFormat) {
    try {
        const response = await queryAI(prompt, maxTokens, temperature, 2, {
            response_format: { type: responseFormat === 'json_object' ? 'json_object' : 'text' }
        });
        return response;
    } catch (err) {
        console.error('Test Error calling LLM:', err.message);
        throw err;
    }
}

const testCases = [
    // --- 1. Multi-statement Splitting ---
    "Show me blue phones and that aside, get me some water.",
    "I'm looking for a laptop, but by the way, do you sell cameras?",
    "Add the first one to cart and then show me something similar to the second one.",
    "I want to see advantages and disadvantages of smartphones.", // Should NOT split
    "Check my order status, also, can I change my shipping address?",
    "Show me phones. Actually, show me laptops instead.",
    "Tell me about the iPhone 15 Pro and Galaxy S24 Ultra.", // Should NOT split (comparison/list)

    // --- 2. Pronoun Skipping (skip_resolve) ---
    "That aside, I want to see shoes.",
    "Could you help with that?",
    "That said, I'm ready to checkout.",
    "I'll try that if it's cheaper.", // "that" (action/offer) should skip, "it" (product) should stay
    "This being said, let's look at the specs.",
    "Add it to cart and show me that one.", // Both should resolve (not skipped)

    // --- 3. Product Extraction (Direct & Indirect) ---
    "I'm looking for Wipes called Angel.",
    "Show me a phone named Titan.",
    "Get me something to eat.", // Should result in "food" being DROPPED by vet logic
    "I want a cheap blue Samsung phone.",
    "Compare the iPhone 12 Pro and Galaxy S24.",
    "Show me some cool gadgets.",
    "I need a particular product which is Wipes called Angel.",

    // --- 4. Adjective Extraction & Scoping ---
    "Show me cheap phones and expensive laptops.",
    "Find a large red bag for me.",
    "The blue one looks good, but I prefer the black version.",
    "Is there a waterproof version of this phone?",

    // --- 5. Hallucination & Vetting Checks ---
    "Show me something i can eat.", // Check if "food" is dropped
    "Add the first one.", // No product should be extracted
    "I'm interested in Crypto and Forex.", // Should have products: []
    "That aside, show me phones.", // Check "that" skipping and "phones" extraction
    "Yeah, lately I've been looking for a particular product which is Wipes called Angel. That aside, I'm trying to weigh the advantage and disadvantages of Crypto and Forex. Could you please help with that?"
];

async function runTests() {
    console.log('🚀 Starting IntelliSense Full Suite Test (30 Cases)...\n');
    console.log('--- Vetting Rules Active ---');
    console.log('1. No food/drink/item/product hallucinations.');
    console.log('2. Significant product tokens must exist in text.');
    console.log('3. Adjectives must exist in text.\n');

    for (let i = 0; i < testCases.length; i++) {
        const text = testCases[i];
        console.log(`[TEST ${i + 1}] Input: "${text}"`);
        try {
            const result = await intelliSense.analyze(text, aiQueryFn);
            if (result) {
                console.log('Result:', JSON.stringify(result, null, 2));
            } else {
                console.log('Result: NULL (check LLM server)');
            }
        } catch (err) {
            console.log('Result: FAILED');
        }
        console.log('---------------------------------------------------\n');
    }
}

runTests();
