/**
 * Probe Backend for Products Endpoint
 * Checks if there's a better endpoint for category filtering than /search
 */

const axios = require('axios');

async function probeProductsEndpoint() {
    const BASE_URL = 'http://localhost:3000';
    const HEADERS = { 'X-Tenant-ID': 'cbe1df05-45ed-455a-9ce6-156b0bd45713' };

    console.log('🔍 Probing Backend for Category Filtering\n');

    const tests = [
        {
            endpoint: '/search/products',
            params: { category: 'ultrabooks', per_page: 5 }
        },
        {
            endpoint: '/search/products',
            params: { q: 'macbook', per_page: 5 }
        },
        {
            endpoint: '/search/products',
            params: { q: 'drey', per_page: 5 } // Collection 'Drey Tech' should return 0 products
        }
    ];

    for (const test of tests) {
        console.log(`\n📋 Test: GET ${test.endpoint}`);
        console.log(`   Params: ${JSON.stringify(test.params)}`);

        try {
            const response = await axios.get(`${BASE_URL}${test.endpoint}`, {
                params: test.params,
                headers: HEADERS
            });
            console.log(`   ✅ Status: ${response.status}`);

            // Try to find the list
            const data = response.data;
            const items = data.products || data.data || data.results || (Array.isArray(data) ? data : []);

            console.log(`   📦 Items Count: ${items.length}`);
            if (items.length > 0) {
                console.log(`   First Item: "${items[0].name || items[0].title}"`);
            }
        } catch (error) {
            console.log(`   ❌ Error: ${error.response?.status} ${error.response?.statusText}`);
        }
    }
}

probeProductsEndpoint();
