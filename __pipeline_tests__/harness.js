/**
 * Test Harness for Pipeline E2E Integration Testing
 * 
 * Provides a simulated environment for the `resolveAndMap` pipeline without
 * hitting production APIs (Groq, Meilisearch) or Redis databases.
 */

// Simulate the database-backed store context
const dummyStoreContext = {
    VENDORS: {
        'vendor_1': { id: 'vendor_1', business_name: 'Dareymi' },
        'vendor_2': { id: 'vendor_2', business_name: 'Togoline' }
    },
    CATEGORIES: {
        'cat_1': { id: 'cat_1', slug: 'smartphones', name: 'Smartphones', total_count: 5 },
        'cat_2': { id: 'cat_2', slug: 'laptops', name: 'Laptops', total_count: 5 }
    }
};

const { resolveAndMap } = require('../src/services/intentResolver');
const intentRegistry = require('../src/services/intentResolver/config/intentRegistry');

/**
 * Mocks the AI generation function to ensure tests run fast and deterministically.
 */
async function mockAiQueryFn(messages, options) {
    // If the pipeline is falling back to AI for parameter extraction or semantic routing,
    // we can return specific predefined JSON structures based on the message.
    return JSON.stringify({
        statements: [
            {
                original: messages[1]?.content || '',
                text: messages[1]?.content || '',
                products: [],
                skip_resolve: []
            }
        ]
    });
}

/**
 * Primary Test Helper: Simulates a user message going through the full NLP routing pipeline.
 * 
 * @param {string} text - The simulated WhatsApp message
 * @param {object} customState - (Optional) Merge overrides into the user's active simulated state
 */
async function simulateMessage(text, customState = {}) {
    const defaultState = {
        user_id: customState.user_id || `test_user_${Math.floor(Math.random() * 1000000)}`,
        product_context: {
            last_search: { results: [] }
        },
        reference_map: {},
        search_context: {
            product_ids: [],
            product_ids_count: 0,
            product_attributes_map_count: 0,
            sample_attrs_map: {}
        },
        user_query_map: {},
        ...customState
    };

    // The core function from src/services/intentResolver/index.js
    const stateManager = require('../src/state/stateManager');

    // Dynamically seed the local memory cache so stateManager natively resolves the test constraints
    await stateManager.updateState(defaultState.user_id, defaultState);
    if (customState.microstate) {
        await stateManager.setMicrostate(defaultState.user_id, customState.microstate);
    } else {
        await stateManager.clearMicrostate(defaultState.user_id);
    }

    const result = await resolveAndMap(
        text,
        defaultState,
        mockAiQueryFn,
        dummyStoreContext
    );

    return result;
}

module.exports = {
    simulateMessage,
    dummyStoreContext
};
