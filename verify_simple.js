
const { extractDeterministic } = require('./src/services/intentResolver/pipeline/parameterExtractor');
const mockContext = { CATEGORIES: { 'phones': { id: 'phone-cat-id' } } };
const candidates = [{ intentName: 'product_search' }];

const test = (label, text, idx) => {
    const resolutions = [{ type: 'resolved_product', value: 'InfinixHot30i', resolvedId: 'uuid123' }];
    const entities = [{ type: 'resolved_product', value: 'InfinixHot30i', wordIndices: [idx], resolvedId: 'uuid123' }];
    const res = extractDeterministic(text, candidates, mockContext, resolutions, 'phone-cat-id', entities);
    console.log(`--- ${label} ---`);
    console.log('SIM_TO:' + (res.similar_to || 'NONE'));
    console.log('REG_NAME:' + (res.product_name || 'NONE'));
    console.log('REG_ID:' + (res._resolved_product_id || 'NONE'));
};

test('SIMILARITY search', 'something similar to InfinixHot30i', 3);
test('REGULAR search', 'find me InfinixHot30i', 2);
