const { resolveAndMap } = require('./src/services/intentResolver/index');
const { CATEGORIES, VENDORS } = require('./src/context/storeContext');

// Mock AI query function
const aiQueryFn = async (prompt, maxTokens, temp, topP, format) => {
    console.log('🤖 [Mock AI] Received prompt:', JSON.stringify(prompt).slice(0, 100) + '...');
    return JSON.stringify({ product_name: 'Mock Product' });
};

// Mock state
const state = {
    history: [],
    reference_map: {},
    ordinal_list: []
};

// Store context
const storeContext = {
    CATEGORIES,
    VENDORS
};

const testQueries = [
    "show me cheap infinixhot30i phones",
    "I need bucksaving smartphones, add the first two to cart",
    "Find me affordable laptops and expensive headsets"
];

async function runTests() {
    console.log('🚀 Starting Pipeline Verification Test...');

    for (const query of testQueries) {
        console.log(`\n📝 Testing Query: "${query}"`);
        try {
            const result = await resolveAndMap(query, state, aiQueryFn, storeContext);

            result.intents.forEach((intent, i) => {
                console.log(`\n  --- Intent ${i + 1}: ${intent.intent} ---`);
                console.log(`  Shape: ${intent.shape || 'N/A'}`);
                console.log(`  Entities:`, intent.entities.map(e => `${e.type}:${e.value}`).join(', '));
                console.log(`  Residuals:`, intent.residualWords.join(', '));
                if (intent.category) console.log(`  Category: ${intent.category}`);
            });

        } catch (e) {
            console.error(`❌ Test failed for query "${query}":`, e);
        }
    }

    console.log('\n✅ Verification Complete.');
}

runTests();
