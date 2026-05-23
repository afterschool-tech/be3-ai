const { processRAGQuery } = require('./src/core/ragService');

async function run() {
    try {
        console.log("Mocking active topic resolution...");
        const res = await processRAGQuery('test-session', 'What does Dareymi sell?', {});
        console.log("RAG Tool Response:");
        console.log(JSON.stringify(res, null, 2));
    } catch (e) {
        console.error("Test failed:", e);
    }
    process.exit(0);
}

run();
