/**
 * Test Category Inventory During Conversational Flow
 * 
 * Replicates the iPhone → TikTok → headset scenario where:
 * 1. User searches for a product (establishes context)
 * 2. Asks for advice about it (GET_ADVICE intent)
 * 3. Casually mentions another product NOT in context
 * 
 * The AI should check category_inventory before saying "we don't have X"
 */

const axios = require('axios');

async function testConversationalInventoryCheck() {
    const session_id = `test_convo_${Date.now()}@test`;
    const BASE_URL = 'http://localhost:3005';

    console.log('🧪 Testing Inventory Check During Conversational Advice Flow\n');
    console.log('This replicates the real scenario where the AI incorrectly denied having headsets.\n');

    const conversation = [
        {
            message: "show me iphone 17",
            description: "Search for product (establishes context)",
            expectation: "Should find and display iPhone 17 Pro"
        },
        {
            message: "can i use it to shoot proper tiktok content?",
            description: "Ask for advice (GET_ADVICE intent)",
            expectation: "Should provide advice about iPhone for TikTok"
        },
        {
            message: "and a headset too right?",
            description: "Casual mention of out-of-context product",
            expectation: "❗ CRITICAL: Should check category_inventory['sound-gadget'] = 1 and suggest searching, NOT say 'we don't have headsets'"
        },
        {
            message: "yes",
            description: "Confirmation to search",
            expectation: "Should trigger search for headsets"
        }
    ];

    for (const turn of conversation) {
        console.log(`\n${'='.repeat(80)}`);
        console.log(`📝 User: "${turn.message}"`);
        console.log(`   Context: ${turn.description}`);
        console.log(`   Expected: ${turn.expectation}`);

        try {
            const response = await axios.post(`${BASE_URL}/chat`, {
                message: turn.message,
                session_id: session_id
            });

            const reply = response.data.reply;
            console.log(`\n✅ AI Reply:`);
            console.log(`   "${reply.substring(0, 300)}${reply.length > 300 ? '...' : ''}"`);
            console.log(`\n   Intent: ${response.data.intent} (confidence: ${response.data.confidence})`);

            // Special check for the critical third message
            if (turn.message === "and a headset too right?") {
                const lowerReply = reply.toLowerCase();
                if (lowerReply.includes("don't have") || lowerReply.includes("dont have") || lowerReply.includes("don't see")) {
                    console.log(`\n   ❌ WARNING: AI said "don't have" - this indicates it didn't check category_inventory!`);
                } else {
                    console.log(`\n   ✅ GOOD: AI didn't definitively deny availability`);
                }
            }
        } catch (error) {
            console.error(`\n❌ Error:`, error.response?.data || error.message);
        }

        // Wait a bit between messages to simulate real conversation
        await new Promise(resolve => setTimeout(resolve, 1500));
    }

    console.log('\n\n' + '='.repeat(80));
    console.log('💡 Manual Verification Checklist:');
    console.log('='.repeat(80));
    console.log('After message 3 ("and a headset too right?"):');
    console.log('  ✓ Did the AI avoid saying "we don\'t have headsets"?');
    console.log('  ✓ Did it suggest searching or mention the sound-gadget category?');
    console.log('  ✓ Was the response helpful and non-contradictory?');
    console.log('  ✓ Did it check category_inventory before responding?');
    console.log('='.repeat(80));
}

testConversationalInventoryCheck();
