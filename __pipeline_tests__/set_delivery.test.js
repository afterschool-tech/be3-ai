const { simulateMessage } = require('./harness');

describe('Democratized Freeflow Ingestion', () => {
    
    test('It should successfully catch "lagos" as an address for set_delivery', async () => {
        // Step 1: Trigger the intent
        const init = await simulateMessage('set my delivery address');
        expect(init.intents[0].intentName).toBe('set_delivery');

        // Verify the microstate is active and asking for an address
        const tools = init.tools;
        expect(tools[0].tool).toBe('microstate.collect');
        expect(tools[0].params.paramName).toBe('address');

        // Step 2: Simulate providing the address while the microstate is active
        const addressInput = await simulateMessage('34, lagos ajah', {
            // Mock Redis state showing an active microstate
            microstate: {
                name: 'collect_delivery_details',
                intent: 'set_delivery',
                contract: {
                    maxMessages: 3,
                    messagesUsed: 1,
                    onFulfilled: ['address', 'delivery_type']
                },
                params: {} 
            }
        });

        // The unified activeParam fallback should map "34, lagos ajah" to the "address" param
        expect(addressInput.intents[0].intentName).toBe('set_delivery');
        expect(addressInput.intents[0].parameters.address).toBe('34 lagos ajah');
    });

    test('It should successfully catch "standard" as delivery_type and not overwrite the address', async () => {
        const typeInput = await simulateMessage('standard', {
            microstate: {
                name: 'collect_delivery_details',
                intent: 'set_delivery',
                contract: {
                    maxMessages: 3,
                    messagesUsed: 2,
                    onFulfilled: ['address', 'delivery_type']
                },
                params: {
                    address: '34, lagos ajah' // Address is already fulfilled in the database!
                } 
            }
        });

        // Verify the activeParam correctly targets delivery_type and saves it
        expect(typeInput.intents[0].parameters.address).toBe('34, lagos ajah'); 
        expect(typeInput.intents[0].parameters.delivery_type).toBe('standard');
    });
});
