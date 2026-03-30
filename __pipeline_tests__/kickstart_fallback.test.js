const intentRegistry = require('../src/services/intentResolver/config/intentRegistry');
const { extractParameters } = require('../src/services/intentResolver/pipeline/parameterExtractor');
const { mapToTool } = require('../src/services/intentResolver/pipeline/toolMapper');

describe('Kickstart fallback wiring', () => {
    test('extractParameters propagates is_kickstart from SEMANTIC_KICKSTART category entities', async () => {
        const candidates = [{ intentName: 'product_search' }];
        const entities = [
            {
                type: 'category',
                source: 'SEMANTIC_KICKSTART',
                id: 'cat_1',
                value: 'smartphones'
            }
        ];

        const aiQueryFn = async () => '{}';

        const result = await extractParameters(
            'show me smartphones',
            candidates,
            aiQueryFn,
            { VENDORS: {}, CATEGORIES: {}, ATTRIBUTES: {} },
            [],
            entities,
            null
        );

        expect(result.is_kickstart).toBe(true);
        expect(result.category).toBe('cat_1');
    });

    test('toolMapper maps is_kickstart into product.search tool params', () => {
        const resolvedIntent = {
            intentName: 'product_search',
            score: 1,
            parameters: {
                query: 'phones',
                category: 'cat_1',
                is_kickstart: true
            }
        };

        const tools = mapToTool(resolvedIntent);
        const toolCall = tools.find(t => t.tool === 'product.search');
        expect(toolCall).toBeDefined();
        expect(toolCall.params.is_kickstart).toBe(true);
    });
});

