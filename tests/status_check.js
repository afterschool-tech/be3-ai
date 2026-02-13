const axios = require('axios');
const fs = require('fs');

const API_URL = 'http://localhost:3005/chat';
const SESSION_ID = 'verify-phase-1-' + Date.now();

async function testQuery(query) {
    console.log(`\nQuery: "${query}"`);
    try {
        const response = await axios.post(API_URL, {
            message: query,
            session_id: SESSION_ID
        });
        console.log(`Reply: ${response.data.reply}`);
        return response.data;
    } catch (error) {
        console.error(`Error: ${error.message}`);
        return null;
    }
}

async function runVerification() {
    console.log('🧪 Starting Phase 1: Context Integration Verification\n');

    // 1. Test Vendor Recognition with Details (Goal: AI should mention delivery scope or product count)
    const q1 = await testQuery("Is Apple a vendor here?");

    // 2. Test Hierarchical Category Awareness (Goal: AI should know about child categories)
    const q2 = await testQuery("What subcategories do you have for Desktops?");

    // 3. Test Intent Mapping (Goal: Map 'laptops' to 'laptops_&_computers' ID)
    const q3 = await testQuery("Show me laptops");
    if (q3 && q3.intent === 'search_products') {
        console.log(`✅ Intent: search_products, Category: ${JSON.stringify(q3.params?.category)}`);
    }

    // 4. Test Availability Reasoning (Goal: AI should admit if a category is empty)
    const q4 = await testQuery("Do you have any All in one PCs?");
    // Context says: "all_in_one_pcs": ... "product_count": 0. 
    // Legacy AI might have said "Let me check". New AI should be more grounded.

    console.log('\n✅ Verification complete.');
}

runVerification();
