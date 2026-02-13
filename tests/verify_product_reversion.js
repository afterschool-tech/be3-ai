const axios = require('axios');

const BACKEND_URL = 'http://localhost:3000';
const TENANT_ID = 'cbe1df05-45ed-455a-9ce6-156b0bd45713';

async function test() {
    console.log('--- Phase 5: Product Module Reversion Verification ---');

    try {
        // 1. Test Listing with Keyword Search (New Feature in Storefront)
        console.log('\n1. Testing Listing with Keyword Search (q=iPhone)...');
        const resList = await axios.get(`${BACKEND_URL}/products/storefront?q=iPhone`, {
            headers: { 'X-Tenant-ID': TENANT_ID }
        });
        console.log(`- Success: ${resList.data.success}`);
        console.log(`- Count: ${resList.data.data.length}`);
        if (resList.data.data.length > 0) {
            console.log(`- First result: ${resList.data.data[0].name}`);
        }

        // 2. Test Price Filtering (New Feature in Storefront)
        console.log('\n2. Testing Price Filtering (price_max=1000)...');
        const resPrice = await axios.get(`${BACKEND_URL}/products/storefront?price_max=1000`, {
            headers: { 'X-Tenant-ID': TENANT_ID }
        });
        console.log(`- Success: ${resPrice.data.success}`);
        console.log(`- Count: ${resPrice.data.data.length}`);

        // 3. Test Detail Reversal
        console.log('\n3. Testing Detail Endpoint Reversal...');
        // Find a first handle
        const handle = resList.data.data[0]?.handle || 'iphone-15';
        const resDetail = await axios.get(`${BACKEND_URL}/products/storefront/products/${handle}`, {
            headers: { 'X-Tenant-ID': TENANT_ID }
        });
        console.log(`- Success: ${resDetail.data.success}`);
        console.log(`- Product: ${resDetail.data.product?.name}`);

        console.log('\n--- VERIFICATION COMPLETE ---');
    } catch (error) {
        console.error('Verification Failed:', error.message);
        if (error.response) {
            console.error('Response Data:', JSON.stringify(error.response.data, null, 2));
        }
    }
}

test();
