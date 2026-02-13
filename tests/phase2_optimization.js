const axios = require('axios');
const API_URL = 'http://localhost:3005/chat';
const SESSION_ID = 'opt-test-' + Date.now();

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';
const YELLOW = '\x1b[33m';

async function verifyOptimization(query, expectedSource, description) {
    console.log(`\n[Test] ${description}`);
    console.log(`Query: "${query}"`);
    try {
        const response = await axios.post(API_URL, {
            message: query,
            session_id: SESSION_ID
        });

        const data = response.data;
        const isOptimized = data.source === 'context';
        const resultSource = data.source || 'api';

        console.log(`Reply: ${data.reply.substring(0, 100)}...`);
        console.log(`Source: ${resultSource} (Expected: ${expectedSource})`);

        if (resultSource === expectedSource) {
            console.log(`${GREEN}✅ PASSED: Source matches expectations.${RESET}`);
            return true;
        } else {
            console.log(`${RED}❌ FAILED: Unexpected source.${RESET}`);
            return false;
        }
    } catch (error) {
        console.error(`${RED}ERROR: ${error.message}${RESET}`);
        return false;
    }
}

async function runOptimizationTests() {
    console.log(`${YELLOW}🧪 Phase 2: API Optimization Verification${RESET}`);
    console.log(`Testing if queries are correctly short-circuited to Context.\n`);

    let passed = 0;
    let total = 0;

    const tests = [
        {
            query: "do you have any nintendo switch left",
            expectedSource: "context",
            desc: "Empty Category Check (Expect 0 API calls)"
        },
        {
            query: "Is Dareymi a vendor here?",
            expectedSource: "context",
            desc: "Vendor Existence Check (Expect 0 API calls)"
        },
        {
            query: "How many items are in the Food category?",
            expectedSource: "context",
            desc: "Category Count Check (Expect 0 API calls)"
        },
        {
            query: "What subcategories are available under Laptops & Computers?",
            expectedSource: "context",
            desc: "Hierarchy Info Check (Expect 0 API calls)"
        },
        {
            query: "Show me all laptops",
            expectedSource: "api",
            desc: "Product Listing Check (Expect 1 API call - Research Required)"
        }
    ];

    for (const t of tests) {
        total++;
        if (await verifyOptimization(t.query, t.expectedSource, t.desc)) passed++;
    }

    console.log(`\n${YELLOW}---------------------------------------${RESET}`);
    console.log(`Final Result: ${passed}/${total} passed`);
    console.log(`${YELLOW}---------------------------------------${RESET}`);

    if (passed < total) {
        process.exit(1);
    }
}

runOptimizationTests();
