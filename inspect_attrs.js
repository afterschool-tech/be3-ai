// Inspect raw attribute structure from the stored product data
const d = require('./real_products.json');
const withAttrs = d.products.filter(p => p._rawAttrKeys !== 'none');
console.log(`Products with attributes: ${withAttrs.length}`);
withAttrs.forEach(p => {
    const parts = [`name: ${p.name}`, `brand: ${p.brand}`, `color: ${p.color}`, `storage: ${p.storage}`, `ram: ${p.ram}`, `material: ${p.material}`, `cat: ${p.category}`].filter(x => !x.endsWith(': undefined') && !x.endsWith(': null'));
    console.log(parts.join(' | '));
});
