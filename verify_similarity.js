
const { extractDeterministic } = require('./src/services/intentResolver/pipeline/parameterExtractor');

// Mock context
const storeContext = {
    CATEGORIES: {
        'phones': { id: 'phone-cat-id', label: 'Phones', attributes: ['brand', 'color'] }
    }
};

const candidates = [{ intentName: 'product_search' }];

function test(label, text, resolutions, entities, categoryId) {
    console.log(`\n--- TEST: ${label} ---`);
    console.log(`Query: "${text}"`);
    try {
        const result = extractDeterministic(text, candidates, storeContext, resolutions, categoryId, entities);
        console.log('Result:', JSON.stringify(result, null, 2));
        return result;
    } catch (e) {
        console.error('ERROR during test:', e.message);
        return null;
    }
}

async function runTests() {
    console.log('Verifying PIE "whatever it sees" + Parameter UUID Extraction');

    // 1. Similar Search with Resolved ID (InfinixHot30i)
    const resolutions1 = [{ type: 'resolved_product', value: 'InfinixHot30i', resolvedId: 'infinix-uuid-123' }];
    const entities1 = [{ type: 'resolved_product', value: 'InfinixHot30i', wordIndices: [3], resolvedId: 'infinix-uuid-123' }];
    const res1 = test('Similarity with Resolved ID', 'something similar to InfinixHot30i', resolutions1, entities1, 'phone-cat-id');

    if (res1 && res1.similar_to === 'infinix-uuid-123' && !res1.product_name) {
        console.log('✅ SUCCESS: similar_to is UUID, product_name suppressed');
    } else {
        console.log('❌ FAILURE in Test 1');
    }

    // 2. Regular Search (InfinixHot30i)
    const res2 = test('Regular Search (No Similarity)', 'show me InfinixHot30i', resolutions1, entities1, 'phone-cat-id');
    if (res2 && res2.product_name === 'infinixhot30i' && res2._resolved_product_id === 'infinix-uuid-123') {
        console.log('✅ SUCCESS: product_name is TOKENS, _resolved_product_id is UUID');
    } else {
        console.log('❌ FAILURE in Test 2');
    }

    // 3. Raw UUID in Similarity
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    const res3 = test('Similarity with Raw UUID', `items like ${uuid}`, [], [], null);
    if (res3 && res3.similar_to === uuid && !res3.product_name) {
        console.log('✅ SUCCESS: raw UUID handled');
    } else {
        console.log('❌ FAILURE in Test 3');
    }
}

runTests();
