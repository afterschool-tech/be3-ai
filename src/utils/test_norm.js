const { normalizeCategory } = require('./normalization');
const { CATEGORIES } = require('../context/storeContext');

// Mock CATEGORIES for testing
const mockCategories = {
    'tablets': { id: 'tablets-id', label: 'Tablets', slug: 'tablets' },
    'windows-tablet': { id: 'windows-tablet-id', label: 'Windows Tablet', slug: 'windows-tablet' },
    'windows-tablet-pro-one': { id: 'windows-tablet-pro-one-id', label: 'Windows Tablet Pro One', slug: 'windows-tablet-pro-one' },
    'windows': { id: 'windows-id', label: 'Windows', slug: 'windows' }
};

const options = { debug: true, returnMeta: true };

console.log('--- TEST 1: Query "tab" ---');
const res1 = normalizeCategory('tab', mockCategories, false, options);
console.log('Winner:', res1.id, 'score:', res1.meta.score);

console.log('\n--- TEST 2: Query "win tab" ---');
const res2 = normalizeCategory('win tab', mockCategories, false, options);
console.log('Winner:', res2.id, 'score:', res2.meta.score);

console.log('\n--- TEST 3: Query "win tab one" ---');
const res3 = normalizeCategory('win tab one', mockCategories, false, options);
console.log('Winner:', res3.id, 'score:', res3.meta.score);

console.log('\n--- TEST 4: Query "windows tablet pro" (Tie-Breaker test) ---');
// Should favor "Windows Tablet Pro One" over "Windows Tablet" because it's more specific
const res4 = normalizeCategory('windows tablet pro', mockCategories, false, options);
console.log('Winner:', res4.id, 'score:', res4.meta.score);
