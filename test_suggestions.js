console.log("STARTING SUGGESTION TEST...");
const apiClient = require('./src/utils/apiClient');
apiClient.callBackendAPI = async (url) => {
    console.log(`[MOCK API] ${url}`);
    // product.search uses 'q=' for the query parameter
    if (url.includes('q=fail')) {
        return { success: true, data: { products: [], pagination: { total: 0 } } };
    }
    // For fallback (no query), return results
    return {
        success: true,
        data: {
            products: [{ id: 's1', name: 'Suggested Item', price: 100 }],
            pagination: { total: 1 }
        }
    };
};

const stateManager = require('./src/state/stateManager');
const { executeTools } = require('./src/core/orchestrator');

(async () => {
    try {
        const tools = [{
            tool: 'product.search',
            params: { query: 'fail' }
        }];

        const context = {
            CATEGORIES: require('./src/context/storeContext').CATEGORIES,
            VENDORS: require('./src/context/storeContext').VENDORS,
            ATTRIBUTES: require('./src/context/storeContext').ATTRIBUTES,
            sessionId: 'test-session'
        };

        const results = await executeTools(tools, 'test-session', context);
        const res = results[0]?.result;

        console.log("--- SUGGESTION TEST RESULTS ---");
        console.log("SUCCESS:", !!res);
        console.log("PRIMARY PRODUCTS:", res?.products?.length);
        console.log("SUGGESTED PRODUCTS:", res?.suggested_products?.length);
        console.log("CARDS GENERATED (Expected False):", !!res?.whatsapp_product_cards);

        if (res?.suggested_products?.length > 0) {
            console.log("SUGGESTION IMAGE SUPPRESSED (Expected YES):", res.suggested_products[0]?.suppress_images ? "YES" : "NO");
        }

    } catch (e) {
        console.error("CRASHED:", e.message);
        console.error(e.stack);
    }
    process.exit(0);
})();
