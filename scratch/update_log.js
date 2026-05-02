const fs = require('fs');
const path = require('path');

const filePath = path.resolve(__dirname, '../src/services/intentResolver/index.js');
let content = fs.readFileSync(filePath, 'utf8');

const oldLog = `                results: extractResults.map((r, idx) => ({
                    statement: textsToAnalyze[idx],
                    entityKeys: Object.keys(r.entities || {}),
                    confidence: r.confidence || {}
                }))`;

const newLog = `                results: extractResults.map((r, idx) => ({
                    statement: textsToAnalyze[idx],
                    entities: r.entities || {},
                    confidence: r.confidence || {}
                }))`;

if (content.includes(oldLog)) {
    content = content.replace(oldLog, newLog);
    fs.writeFileSync(filePath, content);
    console.log('Successfully updated log in index.js');
} else {
    console.log('Target log block not found');
    // Try a regex match
    const regex = /results: extractResults\.map\(\(r, idx\) => \(\{[\s\S]*?entityKeys: Object\.keys\(r\.entities \|\| \{\}\),[\s\S]*?confidence: r\.confidence \|\| \{\}[\s\S]*?\}\)\)/;
    if (regex.test(content)) {
        content = content.replace(regex, `results: extractResults.map((r, idx) => ({
                    statement: textsToAnalyze[idx],
                    entities: r.entities || {},
                    confidence: r.confidence || {}
                }))`);
        fs.writeFileSync(filePath, content);
        console.log('Successfully updated log via regex');
    } else {
        console.log('Regex also failed');
    }
}
