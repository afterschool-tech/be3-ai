/**
 * Fetch ALL products from the backend.
 * Captures ALL attribute keys dynamically — brand, color, storage, size, price_tier, material, quality etc.
 * Saves to real_products.json
 */
const { callBackendAPI, BACKEND_URL, TENANT_ID } = require('./src/utils/apiClient');
const { ATTRIBUTES } = require('./src/context/storeContext');
const fs = require('fs');

// Build a reverse map: short code -> full attribute name  e.g. { b: 'brand', p: 'price_tier', c: 'color', s: 'size', ... }
const CODE_TO_NAME = {};
for (const [name, def] of Object.entries(ATTRIBUTES)) {
    if (def.code) CODE_TO_NAME[def.code] = name;
}

async function fetchProducts() {
    console.log(`Querying backend at ${BACKEND_URL} (tenant: ${TENANT_ID})...`);
    console.log(`Known attribute codes: ${JSON.stringify(CODE_TO_NAME)}`);

    // Use /search (not /search/products) to get full metadata including category_ids
    const res = await callBackendAPI(`/search?per_page=200&page=1&type=product`);
    if (!res.success) { console.error('Failed:', res.error); process.exit(1); }

    const raw = res.data;
    const products = raw.products || raw.results || raw.data || raw || [];
    if (!Array.isArray(products) || products.length === 0) { console.error('No products. Keys:', Object.keys(raw)); process.exit(1); }

    console.log(`\nFetched ${products.length} total products.`);

    const clean = products.map(p => {
        // Merge attributes from root + all variant levels
        const rootAttrs = p.attributes || {};
        const variantAttrs = (p.variants || []).reduce((acc, v) => Object.assign(acc, v.attributes || {}), {});
        const merged = { ...rootAttrs, ...variantAttrs };

        // Expand short codes to full names
        const expandedAttrs = {};
        for (const [key, val] of Object.entries(merged)) {
            const fullName = CODE_TO_NAME[key] || key; // expand or keep as is
            expandedAttrs[fullName] = val;
        }

        return {
            id: p.id || p.product_id,
            name: p.name || p.title,
            category_ids: p.category_ids || p.metadata?.category_ids || (p.categories || []).map(c => c.id || c) || [],
            category: p.category?.name || p.category_name || p.category,
            price: p.price || p.variants?.[0]?.price,
            vendor: p.vendor?.name || p.vendor_name || p.vendor,
            tags: (Array.isArray(p.tags) ? p.tags : (typeof p.tags === 'string' ? [p.tags] : [])).join(', '),
            attrs: expandedAttrs,
            attrKeys: Object.keys(expandedAttrs).join(', ') || 'none'
        };
    }).filter(p => p.name);

    // Print products WITH attributes
    const withAttrs = clean.filter(p => p.attrKeys !== 'none');
    console.log(`\n--- ${withAttrs.length} Products with Attributes ---`);
    withAttrs.forEach(p => {
        const attrStr = Object.entries(p.attrs).map(([k, v]) => `${k}=${v}`).join(' | ');
        console.log(`  ${p.name} [${p.category}] => ${attrStr}`);
    });

    // Print attribute value summary
    const allKeys = new Set(withAttrs.flatMap(p => Object.keys(p.attrs)));
    console.log(`\n--- Attribute Value Summary ---`);
    for (const key of allKeys) {
        const vals = [...new Set(withAttrs.map(p => p.attrs[key]).filter(Boolean))];
        console.log(`  ${key}: ${vals.join(', ')}`);
    }

    // Also fetch facets
    const facetRes = await callBackendAPI(`/search?per_page=1&facets=true`);
    let facets = null;
    if (facetRes.success) {
        const f = facetRes.data?.facets || facetRes.data?.aggregations;
        facets = f?.attributes || f;
    }

    fs.writeFileSync('real_products.json', JSON.stringify({ total: clean.length, products: clean, facets }, null, 2));
    console.log(`\nSaved to real_products.json`);
}

fetchProducts().catch(e => { console.error('Error:', e.message); process.exit(1); });
