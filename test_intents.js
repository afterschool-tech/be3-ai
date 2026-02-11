/**
 * Intent System Test
 * Tests all 16 intents with sample messages
 */

require('dotenv').config();
const axios = require('axios');

const AI_SERVICE_URL = 'http://localhost:3005';
const SESSION_ID = 'test_session_' + Date.now();

// Test messages for each intent
const TEST_CASES = [
    { intent: 'search_products', message: 'Show me laptops under $1000' },
    { intent: 'search_products', message: 'Do you have Samsung phones?' },
    { intent: 'view_product', message: 'Tell me about the iPhone 15' },
    { intent: 'compare_products', message: 'Compare iPhone 15 and Samsung Galaxy S24' },
    { intent: 'add_to_cart', message: 'Add 2 laptops to my cart' },
    { intent: 'view_cart', message: 'What\'s in my cart?' },
    { intent: 'update_quantity', message: 'Change quantity to 3' },
    { intent: 'remove_from_cart', message: 'Remove the laptop from my cart' },
    { intent: 'start_checkout', message: 'I want to checkout' },
    { intent: 'set_delivery_option', message: 'I need express delivery' },
    { intent: 'confirm_order', message: 'Confirm my order' },
    { intent: 'view_orders', message: 'Show me my order history' },
    { intent: 'track_order', message: 'Where is my order?' },
    { intent: 'cancel_order', message: 'Cancel order #12345' },
    { intent: 'help', message: 'What can you do?' },
    { intent: 'fallback_unknown', message: 'asdfghjkl' }
];

async function testIntent(testCase, index) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`Test ${index + 1}/${TEST_CASES.length}: ${testCase.intent}`);
    console.log(`Message: "${testCase.message}"`);
    console.log('='.repeat(80));

    try {
        const response = await axios.post(`${AI_SERVICE_URL}/chat`, {
            message: testCase.message,
            session_id: SESSION_ID,
            history: []
        });

        console.log(`✅ Success!`);
        console.log(`Classified Intent: ${response.data.intent}`);
        console.log(`Confidence: ${response.data.confidence}`);
        console.log(`\nReply:\n${response.data.reply}`);

        return {
            ...testCase,
            success: true,
            classifiedIntent: response.data.intent,
            confidence: response.data.confidence,
            reply: response.data.reply
        };
    } catch (error) {
        console.log(`❌ Failed!`);
        console.log(`Error: ${error.message}`);
        if (error.response) {
            console.log(`Response: ${JSON.stringify(error.response.data, null, 2)}`);
        }

        return {
            ...testCase,
            success: false,
            error: error.message
        };
    }
}

async function runAllTests() {
    console.log('\n🤖 Be3 AI Intent System Test Suite');
    console.log(`Testing ${TEST_CASES.length} intents...\n`);

    // Check if AI service is running
    try {
        await axios.get(`${AI_SERVICE_URL}/health`);
        console.log('✅ AI Service is running\n');
    } catch (error) {
        console.log('❌ AI Service is not running!');
        console.log('Please start the service with: npm start');
        process.exit(1);
    }

    const results = [];

    // Run tests sequentially to avoid rate limits
    for (let i = 0; i < TEST_CASES.length; i++) {
        const result = await testIntent(TEST_CASES[i], i);
        results.push(result);

        // Wait a bit between tests
        if (i < TEST_CASES.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }

    // Summary
    console.log(`\n${'='.repeat(80)}`);
    console.log('TEST SUMMARY');
    console.log('='.repeat(80));

    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

    console.log(`\n✅ Successful: ${successful.length}/${TEST_CASES.length}`);
    console.log(`❌ Failed: ${failed.length}/${TEST_CASES.length}`);

    if (failed.length > 0) {
        console.log('\nFailed Tests:');
        failed.forEach(f => {
            console.log(`  - ${f.intent}: ${f.message}`);
            console.log(`    Error: ${f.error}`);
        });
    }

    // Intent classification accuracy
    console.log('\nIntent Classification Accuracy:');
    const correctClassifications = results.filter(r =>
        r.success && r.classifiedIntent === r.intent
    );
    console.log(`  ${correctClassifications.length}/${successful.length} correctly classified`);

    if (correctClassifications.length < successful.length) {
        console.log('\nMisclassified:');
        results.filter(r => r.success && r.classifiedIntent !== r.intent).forEach(r => {
            console.log(`  - Expected: ${r.intent}, Got: ${r.classifiedIntent}`);
            console.log(`    Message: "${r.message}"`);
        });
    }

    console.log('\n' + '='.repeat(80));
}

// Run tests
runAllTests().catch(console.error);
