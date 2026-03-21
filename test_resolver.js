const { resolveIntent } = require('./src/services/intentResolver/pipeline/schemaResolver');

const res = resolveIntent(
    { entities: [{ type: 'resolved_product', value: 'iphone 13', wordIndices: [0, 1] }], residualWords: [] },
    "iphone 13",
    {},
    {}
);

console.log(JSON.stringify(res.candidates.map(c => ({ intent: c.intentName, score: c.score })), null, 2));
