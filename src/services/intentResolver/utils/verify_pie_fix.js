const { extractProductIntel } = require('./productIntelExtractor');

const entities = [
    { type: 'resolved_product', value: 'Iphone 12 pro', productId: '55f3c6ea-a10c-40fd-9093-60a6982bf2eb', wordIndices: [5] }
];

const excludeSet = new Set(['do', 'you', 'something', 'similar', 'to']);

const text = "do you something similar to iphone12pro";

const results = extractProductIntel({
    text,
    entities,
    intentName: 'product_search',
    excludeSet
});

console.log('--- PIE Results ---');
console.log(JSON.stringify(results, null, 2));

// Test Shield Logic (mini version)
const baseFromEntities = { product_name: 'Iphone 12 pro' };
const deterministic = { product_name: results[0]?.name };

if (baseFromEntities.product_name && deterministic.product_name) {
    const resolvedName = baseFromEntities.product_name.toLowerCase();
    const pieWords = deterministic.product_name.split(/\s+/);
    
    const cleanPieWords = pieWords.filter(word => {
        const w = word.toLowerCase();
        if (resolvedName.includes(w)) return false;
        const collapsedResolved = resolvedName.replace(/\s+/g, '');
        if (collapsedResolved.includes(w)) return false;
        return true;
    });

    let finalName = baseFromEntities.product_name;
    if (cleanPieWords.length > 0) {
        finalName = `${cleanPieWords.join(' ')} ${baseFromEntities.product_name}`;
    }
    console.log('\n--- Final Shielded Name ---');
    console.log(finalName);
}
