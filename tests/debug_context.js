const { getContextSummary, CATEGORY_TREE } = require('../src/context/storeContext');

console.log("=== CATEGORY_TREE ===");
console.log(JSON.stringify(CATEGORY_TREE, null, 2));

console.log("\n\n=== getLeanContext() ===");
const { getLeanContext } = require('../src/context/storeContext');
console.log(JSON.stringify(getLeanContext(), null, 2));
