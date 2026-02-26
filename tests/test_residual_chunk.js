/**
 * [TEST] Residual Chunk Analyzer — Quick test
 * Run: node tests/test_residual_chunk.js
 * Logs go to logs/runs/run_*.log — grep for "TEST:" to find [TEST] output.
 */

const path = require('path');
const { startRun } = require('../src/utils/debugLogger');
const { resolveAndMap } = require('../src/services/intentResolver');
const storeContext = require('../src/context/storeContext');

async function mockAiQuery() {
    return JSON.stringify({
        products: null,
        product_name: null,
        query: null,
        category: null,
        vendor: null,
        attributes: null
    });
}

const mockState = {
    reference_map: {},
    ordinal_list: [],
    product_context: { last_search: { results: [] } },
    user_id: 'test-user'
};

const testQueries = [
    // baseline + skip cases
    'a decent gaming laptop that can run fifa smoothly',
    'show me cheap phones',
    'i want a red cheap ball',
    'add iphone to cart',
    // product_search — complex, likely to run [TEST]
    'I need a good wireless mouse that works for gaming and office work',
    'show me cheap bluetooth speakers that have really good bass',
    'looking for a lightweight laptop bag that fits 15 inch screens',
    'want a durable phone case that protects well against drops',
    'find me a comfortable office chair that has proper lumbar support',
    'need a fast charging cable that works with both iphone and android',
    'show me a smart watch that tracks sleep and heart rate properly',
    'looking for a portable power bank that can charge laptops too',
    'want a mechanical keyboard that has nice rgb lighting',
    'find me noise cancelling headphones that work well on long flights',
    'So here’s what I need today: I’m looking for a really cheap android phone for my younger brother, a decent gaming laptop that can run FIFA smoothly, and I also want to compare the iPhone 15 with the latest Samsung flagship you have. After that, add whichever iPhone is cheaper to my cart, and please give me Dareymi’s WhatsApp number so I can ask about delivery.'
];

async function run() {
    const runId = 'residual_test';
    const logPath = startRun(runId);
    console.log('🧪 [TEST] Residual Chunk Analyzer\n');
    console.log('Log file:', logPath);
    console.log('');

    for (const query of testQueries) {
        console.log(`Query: "${query}"`);
        const result = await resolveAndMap(query, mockState, mockAiQuery, storeContext);
        const tools = result.tools || [];
        const intents = result.intents || [];
        console.log(`  → Intent: ${intents[0]?.intentName || 'none'}, product_name: ${intents[0]?.parameters?.product_name || tools[0]?.params?.query || 'N/A'}`);
        console.log('');
    }

    console.log('---');
    console.log('Check logs for [TEST] entries:');
    console.log('  - TEST:RESIDUAL_CHUNK_SKIP = analyzer skipped (see reason)');
    console.log('  - TEST:RESIDUAL_CHUNK = analyzer ran (chunks, distance, suggested)');
    console.log('');
    console.log('View: grep -A 20 "TEST:"', logPath);
}

run().catch(console.error);
