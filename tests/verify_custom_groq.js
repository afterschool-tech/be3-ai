require('dotenv').config();
const { OpenAI } = require("openai");

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const modelsToTest = [
    "openai/gpt-oss-20b",
    "qwen/qwen3-32b"
];

const client = new OpenAI({
    baseURL: "https://api.groq.com/openai/v1",
    apiKey: GROQ_API_KEY,
});

async function testGroqModels() {
    console.log("--- Groq Custom Model Diagnostic ---");
    for (const model of modelsToTest) {
        try {
            console.log(`Testing model: ${model}...`);
            const completion = await client.chat.completions.create({
                model: model,
                messages: [{ role: "user", content: "Hi" }],
                max_tokens: 5
            });
            console.log(`✅ Success: ${model}`);
        } catch (err) {
            console.error(`❌ Failed: ${model}`);
            console.error(`   Error: ${err.message}`);
        }
        console.log("-----------------------------------");
    }
}

testGroqModels();
