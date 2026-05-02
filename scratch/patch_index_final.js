const fs = require('fs');
const path = require('path');

const filePath = path.resolve(__dirname, '../src/services/intentResolver/index.js');
let content = fs.readFileSync(filePath, 'utf8');

// Replace Clause handling
const clauseOld = `        if (Array.isArray(entities.clause)) {
            shaped.clause = entities.clause.map(key => ({
                key,
                score: confidence[\`clause:\${key}\`] || 0
            }));
        }`;

const clauseNew = `        if (entities.clause && typeof entities.clause === 'object' && !Array.isArray(entities.clause)) {
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

// Replace Category handling
const categoryOld = `        if (Array.isArray(entities.category)) {
            shaped.category = entities.category.map(key => ({
                key,
                score: confidence[\`category:\${key}\`] || 0
            }));
        }`;

const categoryNew = `        if (entities.category && typeof entities.category === 'object' && !Array.isArray(entities.category)) {
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

content = content.replace(clauseOld, clauseNew);
content = content.replace(categoryOld, categoryNew);

fs.writeFileSync(filePath, content);
console.log('Successfully patched index.js');
