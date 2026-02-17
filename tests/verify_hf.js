require('dotenv').config();
const { queryAI } = require("../src/core/hfAiService");

async function verifyHF() {
    console.log("--- Hugging Face Router Connectivity Verification ---");

    const messages = [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Say 'Hugging Face is active!'" }
    ];

    try {
        const start = Date.now();
        // Set maxTokens low for verification
        const response = await queryAI(messages, 50, 0.1);
        const duration = Date.now() - start;

        console.log(`✅ Success!`);
        console.log(`   Response: "${response.trim()}"`);
        console.log(`   Duration: ${duration}ms`);

        if (response.toLowerCase().includes("hugging face is active")) {
            console.log("\n✨ Hugging Face AI service is fully integrated and responsive!");
        } else {
            console.warn("\n⚠️ Response received but content mismatch. AI might be hallucinatory or misconfigured.");
        }

    } catch (err) {
        console.error(`❌ Verification Failed!`);
        console.error(`   Error: ${err.message}`);
    }
}

verifyHF();
