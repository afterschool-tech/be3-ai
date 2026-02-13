/**
 * Vendor Selection Verification
 * Tests that vendors are correctly identified even if context is large.
 */

const { selectTools } = require('../src/core/toolSelector');

async function runTest() {
    console.log("=== STARTING VENDOR SELECTION TEST ===");

    const message = "I need products from Taye's Home decor";
    console.log(`User: "${message}"`);

    const selection = await selectTools(message, []);
    console.log(`Selection:`, JSON.stringify(selection, null, 2));

    const selectedProductSearch = selection.some(s => s.tool === 'product.search' && (s.params.vendor === "Taye's Home Decor" || s.params.attributes?.vendor === "Taye's Home Decor" || s.params.query?.includes("Taye")));

    if (selectedProductSearch) {
        console.log("SUCCESS: product.search selected with correct vendor context.");
    } else {
        console.warn("FAILURE: product.search not selected or vendor missing.");
    }

    console.log("\n=== TEST COMPLETE ===");
}

runTest().catch(err => console.error(err));
