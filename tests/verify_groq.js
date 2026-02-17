require('dotenv').config();
const { queryAI } = require("../src/core/aiService");

async function verifyGroq() {
    console.log("--- Groq Connectivity Verification ---");

    const messages = [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Say 'Groq is active!'" }
    ];

    try {
        const start = Date.now();
        const response = await queryAI(messages, 50, 0.1);
        const duration = Date.now() - start;

        console.log(`✅ Success!`);
        console.log(`   Response: "${response.trim()}"`);
        console.log(`   Duration: ${duration}ms`);

        if (response.toLowerCase().includes("groq is active")) {
            console.log("\n✨ Groq is fully integrated and responsive!");
        } else {
            console.warn("\n⚠️ Response received but content mismatch. AI might be hallucinating or misconfigured.");
        }

    } catch (err) {
        console.error(`❌ Verification Failed!`);
        console.error(`   Error: ${err.message}`);
    }
}

verifyGroq();
