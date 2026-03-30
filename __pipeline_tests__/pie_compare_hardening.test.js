const { extractProductIntel } = require('../src/services/intentResolver/utils/productIntelExtractor');

describe('PIE compare-mode hardening', () => {
    test('product_compare prefers resolved products and drops preamble ghost', () => {
        const text = 'i am a content creator cant decide between iphone 12 and iphone 17';

        // Minimal entity set resembling the real pipeline output:
        // - two resolved_product entities with tight contiguous spans
        // - one (possibly wrong) category entity that would otherwise create a ghost reconstruction
        const entities = [
            { type: 'resolved_product', value: 'iphone 12', source: 'INTELLISENSE_OVERRIDE', wordIndices: [7, 8] },
            { type: 'resolved_product', value: 'iphone 17', source: 'INTELLISENSE_OVERRIDE', wordIndices: [10, 11] },
            { type: 'category', value: 'content creator cant', wordIndices: [3, 4, 5] }
        ];

        const products = extractProductIntel({
            text,
            entities,
            intentName: 'product_compare'
        });

        expect(products.map(p => p.name)).toEqual(['iphone 12', 'iphone 17']);
    });
});

