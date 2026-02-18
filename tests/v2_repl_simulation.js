/**
 * V2 REPL Simulation Test
 * Simulates a live session with creative prompts for all 16 new intents.
 * 
 * Usage: node tests/v2_repl_simulation.js
 */

const { resolveAndMap } = require('../src/services/intentResolver');
const storeContext = require('../src/context/storeContext');

const sessionId = 'repl-session-v2';

// Set up some initial state
const initialState = {
    sessionId: sessionId,
    product_context: {
        currently_viewing: 'prod-123', // e.g. iPhone 12 Pro
        history: [{ type: 'view', id: 'prod-123', name: 'iPhone 12 Pro' }]
    }
};

const testCases = [
    // --- CART ---
    {
        input: "bump my macbook count to 3",
        expectedIntent: "update_cart_quantity",
        params: { products: ['macbook'], quantity: 3 },
        note: "Verb 'bump' + 'count' synonym"
    },
    {
        input: "finished shopping take me to pay",
        expectedIntent: "start_checkout",
        note: "Creative checkout phrasing"
    },

    // --- COLLECTION ---
    {
        input: "explore the summer collection",
        expectedIntent: "browse_collection",
        params: { collection_slug: 'summer-collection' },
        note: "Verb 'explore' + collection"
    },

    // --- CONVERSATION ---
    {
        input: "i don't know how to use this help me",
        expectedIntent: "get_help",
        note: "Help request"
    },
    {
        input: "stop the session we are done",
        expectedIntent: "end_conversation",
        note: "End session"
    },
    {
        input: "the service was great thanks",
        expectedIntent: "give_feedback",
        params: { rating: 5 },
        note: "Feedback/thanks"
    },
    {
        input: "what should i buy for a photographer?",
        expectedIntent: "get_advice",
        note: "Advice request (AI Tool)"
    },

    // --- ORDER ---
    {
        input: "show my previous purchases",
        expectedIntent: "list_orders",
        note: "List orders"
    },
    {
        input: "kill my order #4567",
        expectedIntent: "cancel_order",
        params: { order_number: '4567' },
        note: "Cancel order (verb 'kill')"
    },
    {
        input: "i want it delivered to my office",
        expectedIntent: "set_delivery",
        note: "Set delivery"
    },
    {
        input: "everything looks good finalize the order",
        expectedIntent: "confirm_order",
        note: "Confirm order"
    },

    // --- VENDOR ---
    {
        input: "what else does Samsung sell?",
        expectedIntent: "vendor_products",
        params: { vendor: 'Samsung' },
        note: "Vendor products"
    },
    {
        input: "tell me more about the Apple store info",
        expectedIntent: "vendor_info",
        params: { vendor: 'Apple' },
        note: "Vendor info"
    },
    {
        input: "how can i talk to Nike?",
        expectedIntent: "vendor_contact",
        params: { vendor: 'Nike' },
        note: "Vendor contact"
    },
    {
        input: "which company makes the Galaxy S21?",
        expectedIntent: "vendor_identity",
        params: { product_name: 'Galaxy S21', vendor: 'Samsung' },
        note: "Vendor identity"
    },

    // --- DISCOVERY ---
    {
        input: "surpise me with something new",
        expectedIntent: "discovery_sentinel",
        note: "Discovery sentinel / browse"
    }
];

async function runSimulation() {
    let log = `\n🚀 [V2 REPL Simulation] Running ${testCases.length} creative test cases...\n\n`;
    console.log(log.trim());

    let passedCount = 0;

    for (const testCase of testCases) {
        const { input, expectedIntent, note, params: mockParams } = testCase;
        const msg = `🗣️  User: "${input}" (${note})\n`;
        log += msg;
        process.stdout.write(msg);

        // Define a contextual AI mock for this specific test case
        const mockAiQueryFn = async () => JSON.stringify(mockParams || {});

        try {
            const result = await resolveAndMap(input, initialState, mockAiQueryFn, storeContext);

            const intents = result.intents || [];
            const winner = intents.length > 0 ? intents[0].intentName : 'NONE';
            const winnerScore = intents.length > 0 ? intents[0].score : 0;
            const tool = result.tools && result.tools.length > 0 ? result.tools[0].tool : 'NONE';
            const params = JSON.stringify(intents.length > 0 ? intents[0].parameters : {});

            let status = '';
            if (winner === expectedIntent) {
                status = `  ✅ WINNER: ${winner} (Score: ${winnerScore.toFixed(2)}, Tool: ${tool})\n     PARAMS: ${params}\n`;
                passedCount++;
            } else {
                status = `  ❌ FAIL: Expected ${expectedIntent} but got ${winner}\n`;
                if (intents.length > 0) {
                    status += `     Top Candidates: ${intents.map(i => `${i.intentName} (${i.score.toFixed(2)})`).slice(0, 3).join(', ')}\n`;
                }
            }
            log += status;
            process.stdout.write(status);
        } catch (e) {
            const errMsg = `  🔥 ERROR: ${e.message}\n`;
            log += errMsg;
            console.error(errMsg);
        }
        const line = `   ${'-'.repeat(40)}\n`;
        log += line;
        console.log(line.trim());
    }

    const summary = `\n📊 Simulation complete: ${passedCount}/${testCases.length} creative cases resolved correctly.`;
    log += summary;
    console.log(summary);

    if (passedCount === testCases.length) {
        log += `\n✨ Perfect resolution for all new V2 intents!`;
    } else {
        log += `\n⚠️  Resolution gaps detected. Bench sync or keyword adjustment might be needed.`;
    }

    require('fs').writeFileSync('tests/repl_results_final.txt', log, 'utf8');
    console.log(`\n💾 Results saved to tests/repl_results_final.txt`);
}

runSimulation();
