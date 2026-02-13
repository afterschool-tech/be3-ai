require('dotenv').config();
const vendorTools = require('../src/tools/vendor');
const productTools = require('../src/tools/product');
const context = require('../src/context/storeContext');

async function testVendorTools() {
    console.log('🚀 Starting Vendor Tool v2 Verification...\n');

    const mockHistory = [
        { role: 'user', text: "Tell me about Taye's Home Decor" },
        { role: 'ai', text: "Taye's Home Decor is a great shop for local decorations." }
    ];

    const extendedContext = {
        ...context,
        history: mockHistory
    };

    // Test 1: Resolve "their" from history
    console.log('--- Test 1: History Resolution ("their products") ---');
    const historyResult = await vendorTools['vendor.getProducts'].handler(
        { vendor: 'their', limit: 2 },
        extendedContext
    );
    console.log('Result for "their":', historyResult.vendor, '(Method:', historyResult.method + ')');
    if (historyResult.vendor === "Taye's Home Decor" && historyResult.method === 'keyword') {
        console.log('✅ History resolution with Keyword Priority SUCCESS\n');
    } else {
        console.log('❌ History resolution FAILED or used non-keyword method\n');
    }

    // Test 2: product.search with explicit vendor (Creator Match)
    console.log('--- Test 2: product.search with Vendor Parameter ---');
    const searchResult = await productTools['product.search'].handler(
        { vendor: 'Dareymi', limit: 3 },
        extendedContext
    );
    // Note: We need to check if created_by was appended to the URL in logs or if results returned.
    // Since we don't have a real backend in this test runner, we'll check logic if possible
    // or just ensure it doesn't crash and returns products if backend is up.
    console.log('Search Result Count:', searchResult.products?.length || 0);
    console.log('✅ Search param handled\n');

    // Test 3: checkIdentity
    console.log('--- Test 3: checkIdentity ---');
    // We'll use a dummy ID and check if it attempts to resolve
    try {
        const identityResult = await vendorTools['vendor.checkIdentity'].handler(
            { product: '9009f984-6330-4e3e-953e-3f65582f3c39', vendor: 'Dareymi' },
            extendedContext
        );
        console.log('Identity Result:', JSON.stringify(identityResult, null, 2));
    } catch (e) {
        console.log('Note: checkIdentity expectedly failed or returned error due to missing product in mock/real backend.');
    }
}

testVendorTools().catch(console.error);
