require('dotenv').config();
const axios = require('axios');

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const MODEL_ID = "llama-3.3-70b-versatile";

async function testGroqQuota() {
    console.log("--- Groq API Quota Headers Test ---\n");

    if (!GROQ_API_KEY) {
        console.error("❌ GROQ_API_KEY is not set in environment!");
        return;
    }

    const messages = [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Say 'Test complete!'" }
    ];

    try {
        console.log("Sending request to Groq API...\n");

        const response = await axios.post(
            "https://api.groq.com/openai/v1/chat/completions",
            {
                model: MODEL_ID,
                messages: messages,
                max_tokens: 50,
                temperature: 0.1
            },
            {
                headers: {
                    "Authorization": `Bearer ${GROQ_API_KEY}`,
                    "Content-Type": "application/json"
                }
            }
        );

        console.log("✅ Request successful!");
        console.log(`   Response: "${response.data.choices[0].message.content.trim()}"\n`);

        console.log("--- Response Headers (Quota Info) ---");

        const quotaHeaders = [
            'x-ratelimit-limit-requests',
            'x-ratelimit-remaining-requests',
            'x-ratelimit-limit-tokens',
            'x-ratelimit-remaining-tokens',
            'x-ratelimit-reset-requests',
            'x-ratelimit-reset-tokens',
            'x-request-id',
            'x-groq-region'
        ];

        let foundAny = false;
        for (const header of quotaHeaders) {
            const value = response.headers[header];
            if (value) {
                console.log(`   ${header}: ${value}`);
                foundAny = true;
            }
        }

        if (!foundAny) {
            console.log("   ⚠️ No quota headers found in response");
        }

        console.log("\n--- All Headers (for reference) ---");
        for (const [key, value] of Object.entries(response.headers)) {
            if (key.startsWith('x-') || key.includes('ratelimit') || key.includes('quota')) {
                console.log(`   ${key}: ${value}`);
            }
        }

    } catch (err) {
        console.error(`❌ Request failed!`);
        console.error(`   Status: ${err.response?.status || 'N/A'}`);
        console.error(`   Error: ${err.message}`);

        if (err.response?.headers) {
            console.log("\n--- Error Response Headers ---");
            for (const [key, value] of Object.entries(err.response.headers)) {
                if (key.startsWith('x-') || key.includes('ratelimit') || key.includes('quota')) {
                    console.log(`   ${key}: ${value}`);
                }
            }
        }
    }
}

testGroqQuota();
