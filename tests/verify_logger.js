const { logDebug } = require('../src/utils/debugLogger');
const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '../logs/full_debug.log');

console.log("--- Testing Debug Logger ---");

// 1. Clear log file (optional, but good for clean test)
// if (fs.existsSync(LOG_FILE)) fs.unlinkSync(LOG_FILE);

// 2. Write a test log
const testData = { message: "Hello Debug World", timestamp: Date.now() };
logDebug("TEST_SECTION", testData);

// 3. Verify it exists
if (fs.existsSync(LOG_FILE)) {
    const content = fs.readFileSync(LOG_FILE, 'utf8');
    if (content.includes("TEST_SECTION") && content.includes("Hello Debug World")) {
        console.log("✅ SUCCESS: Log entry written and verified.");
    } else {
        console.error("❌ FAILURE: Log file exists but content is missing.");
    }
} else {
    console.error("❌ FAILURE: Log file was not created.");
}
