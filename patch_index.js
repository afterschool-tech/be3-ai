const fs = require('fs');
let file = fs.readFileSync('c:/Users/chatz/Downloads/eCommerce/be3_ai/src/services/intentResolver/index.js', 'utf8');

// Replace clause array handling
const oldClause = `if (Array.isArray(entities.clause)) {
            shaped.clause = entities.clause.map(key => ({
                key,
                score: confidence[\`clause:\${key}\`] || 0
            }));
        }`;
const newClause = `if (entities.clause && typeof entities.clause === 'object' && !Array.isArray(entities.clause)) {
            shaped.clause = Object.entries(entities.clause).flatMap(([key, words]) => 
                words.map(matchedWord => ({
                    key,
                    matchedWord,
                    score: confidence[\`clause:\${key}\`] || 0
                }))
            );
        } else if (Array.isArray(entities.clause)) {
            shaped.clause = entities.clause.map(key => ({
                key,
                score: confidence[\`clause:\${key}\`] || 0
            }));
        }`;

// Replace category array handling
const oldCategory = `if (Array.isArray(entities.category)) {
            shaped.category = entities.category.map(key => ({
                key,
                score: confidence[\`category:\${key}\`] || 0
            }));
        }`;
const newCategory = `if (entities.category && typeof entities.category === 'object' && !Array.isArray(entities.category)) {
            shaped.category = Object.entries(entities.category).flatMap(([key, words]) => 
                words.map(matchedWord => ({
                    key,
                    matchedWord,
                    score: confidence[\`category:\${key}\`] || 0
                }))
            );
        } else if (Array.isArray(entities.category)) {
            shaped.category = entities.category.map(key => ({
                key,
                score: confidence[\`category:\${key}\`] || 0
            }));
        }`;

// vendor handling (doesn't exist currently in reshapeExtractEntities, we need to add it!)
// Let's add it before attribute

const oldVendorTarget = `        // attribute: { brand: ["iphone"] }`;
const newVendor = `        // vendor: { "apple": ["apple"] }
        if (entities.vendor && typeof entities.vendor === 'object' && !Array.isArray(entities.vendor)) {
            shaped.vendor = Object.entries(entities.vendor).flatMap(([key, words]) => 
                words.map(matchedWord => ({
                    key,
                    matchedWord,
                    score: confidence[\`vendor:\${key}\`] || 0
                }))
            );
        } else if (Array.isArray(entities.vendor)) {
            shaped.vendor = entities.vendor.map(key => ({
                key,
                score: confidence[\`vendor:\${key}\`] || 0
            }));
        }

        // attribute: { brand: ["iphone"] }`;

file = file.replace(oldClause, newClause);
file = file.replace(oldCategory, newCategory);
file = file.replace(oldVendorTarget, newVendor);

fs.writeFileSync('c:/Users/chatz/Downloads/eCommerce/be3_ai/src/services/intentResolver/index.js', file);
console.log('Patched index.js successfully');
