require('dotenv').config({ path: 'be3_ai/.env' });
const productTools = require('../src/tools/product');
const storeContext = require('../src/context/storeContext');

async function testEmptyCategoryOptimization() {
    console.log("--- Testing Context-First Optimization ---");

    // Find a category with 0 products
    const emptyCatKey = Object.keys(storeContext.CATEGORIES).find(k => storeContext.CATEGORIES[k].total_count === 0);

    if (!emptyCatKey) {
        console.log("⚠️ No empty categories found using context. Cannot test optimization.");
        return;
    }

    const emptyCat = storeContext.CATEGORIES[emptyCatKey];
    console.log(`Testing with empty category: ${emptyCat.label} (${emptyCat.slug})`);

    // Call product.search
    const result = await productTools['product.search'].handler({
        category: emptyCat.slug,
        query: "best product ever"
    }, storeContext);

    console.log("Result:", JSON.stringify(result, null, 2));

    if (result.products.length === 0 && result.message && result.message.includes("don't have any products")) {
        console.log("✅ SUCCESS: Optimization worked! Returned early message.");
    } else {
        console.error("❌ FAILURE: Did not return expected early exit message.");
    }
}

testEmptyCategoryOptimization();
