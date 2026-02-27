const { normalizeCategory } = require('../src/utils/normalization');
const { CATEGORIES } = require('../src/context/storeContext');

const findCategoryById = (id) => {
    if (!id) return null;
    return Object.values(CATEGORIES).find(c => c && c.id === id) || null;
};

const phrasesFromCli = process.argv.slice(2).filter(Boolean);

const phrases = phrasesFromCli.length > 0
    ? phrasesFromCli
    : [
        'laptops',
        'computers',
        'laptops computers',
        'to buy laptops',
        'buy laptops',
        'i want to buy laptops',
        'show me laptops',
        'smartphones',
        'iphone',
        'iphones',
        'ram storage',
        'ram & storage'
    ];

for (const p of phrases) {
    const id = normalizeCategory(p, CATEGORIES, false, { debug: true, topK: 10 });
    const cat = findCategoryById(id);

    const out = {
        phrase: p,
        resolved: id
            ? {
                id,
                label: cat?.label || null,
                slug: cat?.slug || null
            }
            : null
    };

    console.log(JSON.stringify(out, null, 2));
}
