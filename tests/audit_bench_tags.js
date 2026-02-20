/**
 * Deep entity pattern analysis for structural extraction planning.
 */
const fs = require('fs');
const path = require('path');

const benchPath = path.join(__dirname, '../src/services/intentResolver/semanticLab/intents/joint_bench.json');
const data = JSON.parse(fs.readFileSync(benchPath, 'utf8'));

const lines = [];
const log = (s) => lines.push(s);

// 1. Vendor intents: how do vendor names appear?
log('=== VENDOR ENTITY PATTERNS ===\n');
for (const vi of ['vendor_products', 'vendor_info', 'vendor_contact', 'vendor_identity']) {
    const entry = data[vi];
    if (!entry) continue;
    log(`\n--- ${vi} ---`);

    // Find variations that have [product] AND text around it
    const withProduct = entry.variations.filter(v => v.includes('[product]'));
    const withoutProduct = entry.variations.filter(v => !v.includes('[product]'));

    // Look for vendor-like references: "this vendor", "the seller", etc.
    const vendorRefs = withoutProduct.filter(v =>
        /this (vendor|seller|store|shop|brand)/i.test(v) ||
        /the (vendor|seller|store|shop|brand)/i.test(v) ||
        /that (vendor|seller|store|shop|brand)/i.test(v)
    );

    log(`  Total: ${entry.variations.length}`);
    log(`  With [product] tag: ${withProduct.length}`);
    log(`  Without any tag: ${withoutProduct.length}`);
    log(`  With generic vendor refs ("this/the vendor"): ${vendorRefs.length}`);
    log(`  Samples with product tag:`);
    withProduct.slice(0, 5).forEach(v => log(`    "${v}"`));
    log(`  Samples without tags:`);
    withoutProduct.slice(0, 5).forEach(v => log(`    "${v}"`));
}

// 2. Product Compare: multi-entity patterns
log('\n\n=== PRODUCT COMPARE ENTITY PATTERNS ===');
const pc = data['product_compare'];
if (pc) {
    // Show patterns with [product] to understand multi-slot templates
    const pVars = pc.variations.filter(v => v.includes('[product]'));
    log(`Total with [product]: ${pVars.length}`);
    log('Sample templates:');
    pVars.slice(0, 20).forEach(v => log(`  "${v}"`));
}

// 3. Order intents: order_id patterns
log('\n\n=== ORDER ENTITY PATTERNS ===');
for (const oi of ['order_status', 'cancel_order', 'confirm_order']) {
    const entry = data[oi];
    if (!entry) continue;
    log(`\n--- ${oi} ---`);

    // Look for # patterns (order IDs)
    const withHash = entry.variations.filter(v => v.includes('#'));
    const withOrderNum = entry.variations.filter(v => /order\s*(number|num|no|id|#)/i.test(v));
    log(`  With # symbol: ${withHash.length}`);
    log(`  With "order number/id": ${withOrderNum.length}`);
    log('  Samples with #:');
    withHash.slice(0, 5).forEach(v => log(`    "${v}"`));
}

// 4. Product Search: category/attribute patterns
log('\n\n=== PRODUCT SEARCH CATEGORY/ATTRIBUTE PATTERNS ===');
const ps = data['product_search'];
if (ps) {
    // Find variations mentioning common attributes
    const withPrice = ps.variations.filter(v => /under|below|cheap|budget|expensive/i.test(v));
    const withCategory = ps.variations.filter(v => /categor|section|department/i.test(v));
    log(`  With price refs: ${withPrice.length}`);
    log(`  With category refs: ${withCategory.length}`);
    log('  Price samples:');
    withPrice.slice(0, 5).forEach(v => log(`    "${v}"`));
    log('  Category samples:');
    withCategory.slice(0, 5).forEach(v => log(`    "${v}"`));
}

// 5. Discovery: what entities appear?
log('\n\n=== DISCOVERY SENTINEL PATTERNS ===');
const ds = data['discovery_sentinel'];
if (ds) {
    ds.variations.slice(0, 10).forEach(v => log(`  "${v}"`));
}

// 6. Get Advice: intent-specific entity patterns
log('\n\n=== GET_ADVICE PATTERNS ===');
const ga = data['get_advice'];
if (ga) {
    ga.variations.slice(0, 10).forEach(v => log(`  "${v}"`));
}

fs.writeFileSync(path.join(__dirname, 'audit_entities.md'), lines.join('\n'), 'utf8');
console.log('Done! Written to tests/audit_entities.md');
