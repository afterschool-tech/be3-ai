/**
 * Phase 4: Complex Tool Scenarios Test
 * Verifies detailed functionality of expanded toolset:
 * - Collections & Attributes
 * - Product Comparison & Advice
 * - Cart Management (Add, Update, Remove)
 * - Conversation Flow
 */

const { executeTools } = require('../src/core/orchestrator');
const stateManager = require('../src/state/stateManager');

const SESSION_ID = 'test-phase4-complex';

async function runComplexTest() {
    console.log('🧪 Starting Phase 4 Complex Tools Test...\n');

    try {
        // Initialize State
        await stateManager.getState(SESSION_ID);
        await stateManager.addMessage(SESSION_ID, 'system', 'Phase 4 Test Start');

        // ---------------------------------------------------------
        // SCENARIO 1: Discovery (Collections & Attributes)
        // ---------------------------------------------------------
        console.log('\n--- SCENARIO 1: Discovery ---');

        const discoveryTools = [
            { tool: 'collection.list', params: {} },
            { tool: 'attribute.list', params: { category_slug: 'smartphones' } }
        ];

        console.log('1. Exploring collections and attributes...');
        const discoveryResults = await executeTools(discoveryTools, SESSION_ID);

        const cols = discoveryResults.find(r => r.tool === 'collection.list');
        if (cols.success && cols.result.collections) {
            console.log(`- Collections found: ${cols.result.collections.length}`);
        } else {
            console.warn(`- Collection list error: ${cols.error || cols.result.error}`);
        }

        const attrs = discoveryResults.find(r => r.tool === 'attribute.list');
        if (attrs.success && attrs.result.attributes) {
            console.log(`- Smartphone attributes found: ${attrs.result.attributes.length}`);
        } else {
            console.warn(`- Attribute list error: ${attrs.error || attrs.result.error}`);
        }


        // ---------------------------------------------------------
        // SCENARIO 2: Advanced Product Interaction (Compare & Advice)
        // ---------------------------------------------------------
        console.log('\n--- SCENARIO 2: Product Interaction ---');

        const productInteractionTools = [
            {
                tool: 'product.compare',
                params: { product_names: ['iPhone 15', 'Samsung S23'] }
            },
            {
                tool: 'product.getAdvice',
                params: { product_name: 'iPhone 15' }
            }
        ];

        console.log('2. Comparing products and asking for advice...');
        const interactionResults = await executeTools(productInteractionTools, SESSION_ID);

        const compare = interactionResults.find(r => r.tool === 'product.compare');
        if (compare.success && compare.result.comparison) {
            console.log(`- Comparison successful: ${compare.result.comparison.count} products compared.`);
        } else {
            console.warn(`- Comparison failed/warned: ${compare.error || compare.result.error}`);
        }

        const advice = interactionResults.find(r => r.tool === 'product.getAdvice');
        if (advice.success && advice.result.product) {
            console.log(`- Advice received for: ${advice.result.product.name}`);
        } else {
            console.warn(`- Advice failed/warned: ${advice.error || advice.result.error}`);
        }


        // ---------------------------------------------------------
        // SCENARIO 3: Full Cart Lifecycle
        // ---------------------------------------------------------
        console.log('\n--- SCENARIO 3: Cart Lifecycle ---');

        const searchTools = [{ tool: 'product.search', params: { q: 'phone', limit: 1 } }];
        const searchResFound = await executeTools(searchTools, SESSION_ID);
        const product = searchResFound[0]?.result?.products?.[0];

        if (!product) {
            console.warn('⚠️ Skipping Cart Test: No products found to add.');
        } else {
            console.log(`Target Product: ${product.name} (${product.id})`);

            // 1. Add to Cart
            console.log('3a. Adding to cart...');
            const addRes = await executeTools([{
                tool: 'cart.add',
                params: { product_id: product.id, quantity: 1 }
            }], SESSION_ID);

            if (!addRes[0].success || addRes[0].result.error) {
                console.error(`Cart Add Failed: ${addRes[0].error || addRes[0].result.error}`);
            } else {
                console.log('- Item added.');

                // 2. View Cart & Get Item ID
                console.log('3b. Viewing cart...');
                const viewRes = await executeTools([{ tool: 'cart.view', params: {} }], SESSION_ID);
                const cartItems = viewRes[0].result.items || [];
                const targetItem = cartItems.find(i => i.product_id === product.id || i.product_name === product.name);

                if (!targetItem) {
                    console.error('Cart View Failed: Item not found in cart');
                    console.log('Cart state:', JSON.stringify(viewRes[0].result, null, 2));
                } else {
                    console.log(`- Cart Item ID found: ${targetItem.id}`);

                    // 3. Update Quantity
                    console.log('3c. Updating quantity...');
                    const updateRes = await executeTools([{
                        tool: 'cart.updateQuantity',
                        params: { cart_item_id: targetItem.id, quantity: 3 }
                    }], SESSION_ID);

                    if (!updateRes[0].success || updateRes[0].result.error) {
                        console.error(`Cart Update Failed: ${updateRes[0].error || updateRes[0].result.error}`);
                    } else {
                        console.log(`- Quantity updated.`);

                        // 4. Remove Item
                        console.log('3d. Removing item...');
                        const removeRes = await executeTools([{
                            tool: 'cart.remove',
                            params: { cart_item_id: targetItem.id }
                        }], SESSION_ID);

                        if (!removeRes[0].success || removeRes[0].result.error) {
                            console.error(`Cart Remove Failed: ${removeRes[0].error || removeRes[0].result.error}`);
                        } else {
                            console.log('- Item removed.');
                        }
                    }
                }
            }
        }

        // ---------------------------------------------------------
        // SCENARIO 4: Conversation Support
        // ---------------------------------------------------------
        console.log('\n--- SCENARIO 4: Conversation ---');
        const convoResult = await executeTools([
            { tool: 'conversation.help', params: {} },
            { tool: 'conversation.feedback', params: { rating: 5, comment: 'Great test!' } }
        ], SESSION_ID);

        if (convoResult[0].success) console.log(`- Help message received.`);
        if (convoResult[1].success) console.log(`- Feedback success.`);


        console.log('\n✅ PHASE 4 COMPLEX TEST FINISHED!');

    } catch (error) {
        console.error('\n❌ TEST CRASHED:', error);
        process.exit(1);
    }
}

runComplexTest();
