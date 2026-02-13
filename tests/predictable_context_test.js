const axios = require('axios');
const API_URL = 'http://localhost:3005/chat';
const SESSION_ID = 'predictable-test-' + Date.now();

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';
const YELLOW = '\x1b[33m';

async function verify(query, expectedKeywords, description) {
    console.log(`\n[Test] ${description}`);
    console.log(`Query: "${query}"`);
    try {
        const response = await axios.post(API_URL, {
            message: query,
            session_id: SESSION_ID
        });
        const reply = response.data.reply;
        console.log(`Reply: ${reply}`);

        const missing = expectedKeywords.filter(k => !reply.toLowerCase().includes(k.toLowerCase()));

        if (missing.length === 0) {
            console.log(`${GREEN}✅ PASSED${RESET}`);
            return true;
        } else {
            console.log(`${RED}❌ FAILED${RESET} (Missing: ${missing.join(', ')})`);
            return false;
        }
    } catch (error) {
        console.error(`${RED}ERROR: ${error.message}${RESET}`);
        return false;
    }
}

async function runPredictableTests() {
    console.log(`${YELLOW}🧪 Starting Predictable Context Verification${RESET}\n`);

    let passed = 0;
    let total = 0;

    const tests = [
        {
            query: "Tell me about the vendor Dareymi",
            keywords: ["Dareymi", "National", "1 product"],
            desc: "Vendor Verification (Dareymi delivery & count)"
        },
        {
            query: "Do you have any All in one PCs?",
            keywords: ["don't have", "currently", "search", "Desktops"],
            desc: "Zero-Count Category Check (Grounded refusal + suggestion)"
        },
        {
            query: "What subcategories are available under Desktops?",
            keywords: ["All in one PCs", "Gaming Desktops", "Workstations"],
            desc: "Hierarchy Verification (Desktops children)"
        },
        {
            query: "I want to buy food",
            keywords: ["Food", "10 products"],
            desc: "High-Count Category Acknowledgement"
        },
        {
            query: "What attributes can I filter Android Phones by?",
            keywords: ["brand", "storage"],
            desc: "Category Attribute Awareness"
        }
    ];

    for (const t of tests) {
        total++;
        if (await verify(t.query, t.keywords, t.desc)) passed++;
    }

    console.log(`\n${YELLOW}---------------------------------------${RESET}`);
    console.log(`Final Result: ${passed}/${total} passed`);
    console.log(`${YELLOW}---------------------------------------${RESET}`);

    if (passed < total) {
        process.exit(1);
    }
}

runPredictableTests();
