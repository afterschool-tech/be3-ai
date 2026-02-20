/**
 * Diagnostic - Inspect clause mapping in parameterExtractor
 */
const { CLAUSES } = require('../src/context/clauses');

const clauseWordSet = new Set();
const clauseWordToId = new Map();
for (const [clauseId, clause] of Object.entries(CLAUSES)) {
    const labelWords = clause.label.toLowerCase().split(/\s+/);
    labelWords.forEach(w => { clauseWordSet.add(w); clauseWordToId.set(w, clauseId); });
    (clause.matches || []).forEach(m => {
        const mLower = m.toLowerCase();
        clauseWordSet.add(mLower);
        clauseWordToId.set(mLower, clauseId);
    });
    const displayWords = `${clause.display?.prefix || ''} ${clause.display?.suffix || ''}`.toLowerCase().split(/\s+/).filter(Boolean);
    displayWords.forEach(w => { clauseWordSet.add(w); clauseWordToId.set(w, clauseId); });
}

console.log('Value for "the" before prune:', clauseWordToId.get('the'));

['by', 'for', 'the', 'a', 'and', 'of', 'in', 'men', 'ladies', 'gaming', 'high', 'small', 'color'].forEach(w => {
    clauseWordSet.delete(w);
    clauseWordToId.delete(w);
});

console.log('Value for "the" after prune:', clauseWordToId.get('the'));
console.log('Value for "surface":', clauseWordToId.get('surface'));

// Check which clause had "the"
for (const [clauseId, clause] of Object.entries(CLAUSES)) {
    if (JSON.stringify(clause).toLowerCase().includes('"the"')) {
        console.log(`Found "the" in clause: ${clauseId}`);
    }
}
