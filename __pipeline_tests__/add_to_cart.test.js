const { simulateMessage } = require('./harness');

describe('Add to Cart Parameter Mapping', () => {
    test('It should map "products" to "product_id" for the cart.add tool', async () => {
        const response = await simulateMessage('add it to cart', {
            product_context: {
                last_search: {
                    results: [
                        { id: 'uuid-123', name: 'MacBook Pro' }
                    ]
                }
            },
            reference_map: {
                'it': 'uuid-123'
            }
        });

        expect(response.intents[0].intentName).toBe('add_to_cart');
        
        const cartTool = response.tools.find(t => t.tool === 'cart.add');
        expect(cartTool).toBeDefined();
        
        // Ensure my recent bug fix successfully routed the param via product_id
        expect(cartTool.params.product_id).toBe('uuid-123');
        expect(cartTool.params.product_name).toBeUndefined();
    });
});
