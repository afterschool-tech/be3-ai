require('dotenv').config();
const productTools = require('../src/tools/product');
const { CATEGORIES } = require('../src/context/storeContext');

async function testResolution() {
    console.log("--- Testing Legacy Search Restoration ---");

    // Mock context
    const context = {
        sessionId: 'test-session',
        userMessage: 'Show me expensive iPhones',
        history: [],
        CATEGORIES: CATEGORIES
    };

    console.log("Test 1: Semantic Search ('expensive iPhones')");
    try {
        const result = await productTools['product.search'].handler({
            query: 'expensive',
            category: 'smartphones',
            limit: 3
        }, context);

        if (result.products) {
            console.log(`✅ Success! Found ${result.products.length} products.`);
            if (result.resolved_slug) {
                console.log(`✅ Slug Resolved: ${result.resolved_slug}`);
            }
            if (result.seo) {
                console.log(`✅ SEO Title: ${result.seo.title}`);
            }
            result.products.forEach(p => console.log(` - ${p.name}: ${p.price}`));
        } else {
            console.log("❌ Failed: No products returned.");
            console.log(result);
        }
    } catch (e) {
        console.error("❌ Error during search:", e.message);
    }
}

testResolution();
