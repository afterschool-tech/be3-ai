console.log("STARTING TEST...");
const apiClient = require('./src/utils/apiClient');
apiClient.callBackendAPI = async (url) => {
    console.log(`[MOCK API] ${url}`);
    return {
        success: true,
        data: {
            products: [{ id: 'p1', name: 'MOCK PRODUCT', price: 100 }],
            pagination: { total: 1 }
        }
    };
};

const stateManager = require('./src/state/stateManager'); // Correct: Default export
const { executeTools } = require('./src/core/orchestrator');

(async () => {
    try {
        console.log("PREPARING TOOLS...");
        const tools = [{
            tool: 'product.search',
            params: { query: 'test' },
            pipelineContext: { engineered_see_results: true }
        }];

        const context = {
            CATEGORIES: require('./src/context/storeContext').CATEGORIES,
            VENDORS: require('./src/context/storeContext').VENDORS,
            ATTRIBUTES: require('./src/context/storeContext').ATTRIBUTES,
            sessionId: 'test-session'
        };

        console.log("EXECUTING TOOLS...");
        const results = await executeTools(tools, 'test-session', context);

        console.log("RESULT RETURNED.");
        const res = results[0]?.result;
        console.log("SUCCESS:", res?.success);
        console.log("PRODUCTS COUNT:", res?.products?.length);
        console.log("CARDS GENERATED:", !!res?.whatsapp_product_cards);

        if (res?.whatsapp_product_cards) {
            console.log("CARD COUNT:", res.whatsapp_product_cards.cards?.length);
            console.log("FIRST CARD NAME:", res.whatsapp_product_cards.cards[0]?.sponsor?.name);
        }

    } catch (e) {
        console.error("CRASHED:", e.message);
        console.error(e.stack);
    }
    process.exit(0);
})();
