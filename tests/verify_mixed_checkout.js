require('dotenv').config();
const axios = require('axios');

const BACKEND_URL = 'http://localhost:3000';
const TENANT_ID = 'cbe1df05-45ed-455a-9ce6-156b0bd45713';
const SESSION_ID = 'test_mixed_checkout_' + Date.now();

const cartTools = require('../src/tools/cart');
const orderTools = require('../src/tools/order');

async function testMixedCheckout() {
    console.log('🧪 Testing Mixed Checkout (WhatsApp + In-house)...');

    try {
        const context = { sessionId: SESSION_ID };

        // 1. Add WhatsApp product (Dareymi)
        console.log('\n1. Adding WhatsApp product (Dareymi)...');
        await cartTools['cart.add'].handler({ product_id: '25910fb7-bdb2-4022-b2e4-e0405fdbbfc2', quantity: 1 }, context);

        // 2. Add In-house product (Bola Foods)
        console.log('\n2. Adding In-house product (Bola Foods)...');
        await cartTools['cart.add'].handler({ product_id: '62d41fb1-384a-4f22-9528-fa75b44234a5', quantity: 1 }, context);

        // 3. View Cart Grouped
        console.log('\n3. Viewing Gropeed Cart...');
        const cartView = await cartTools['cart.view'].handler({}, context);
        console.log('Cart Vendor Groups:', JSON.stringify(cartView.vendor_groups, null, 2));

        if (cartView.vendor_groups.length !== 2) {
            throw new Error(`Expected 2 vendor groups, got ${cartView.vendor_groups.length}`);
        }

        // 4. Perform Checkout
        console.log('\n4. Performing Grouped Checkout...');
        const checkoutResult = await orderTools['order.checkout'].handler({
            customer_name: 'Antigravity Test',
            customer_email: 'test@example.com'
        }, context);

        console.log('Checkout Result:', JSON.stringify(checkoutResult, null, 2));

        // Validations
        if (checkoutResult.vendor_breakdown.length !== 2) {
            console.log('Final Result:', JSON.stringify(checkoutResult, null, 2));
            throw new Error('Breakdown should have 2 vendors');
        }

        const waGroup = checkoutResult.vendor_breakdown.find(v => v.type === 'whatsapp');
        const inhouseGroup = checkoutResult.vendor_breakdown.find(v => v.type === 'inhouse');

        if (!waGroup || !waGroup.whatsapp_link) {
            console.log('Final Result:', JSON.stringify(checkoutResult, null, 2));
            throw new Error('WhatsApp group missing link');
        }

        if (!inhouseGroup || !inhouseGroup.checkout_url) {
            throw new Error('In-house group missing checkout URL');
        }

        if (checkoutResult.whatsapp_only !== false || checkoutResult.inhouse_required !== true) {
            throw new Error('Flags for mixed checkout are incorrect');
        }

        console.log('\n✅ Mixed Checkout Verification Passed!');

    } catch (error) {
        console.error('\n❌ Verification Failed:', error.message);
        process.exit(1);
    }
}

testMixedCheckout();
