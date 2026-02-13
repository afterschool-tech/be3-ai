/**
 * Phase 4: Dynamic Conversational Test
 * 
 * Simulates a real multi-turn conversation where the AI dynamically 
 * selects tools based on the flow.
 */

const { selectTools } = require('../src/core/toolSelector');
const { executeTools } = require('../src/core/orchestrator');
const { getContextSummary } = require('../src/context/storeContext');
const { queryAI } = require('../src/core/aiService');
const stateManager = require('../src/state/stateManager');

const SESSION_ID = 'dynamic-chat-test-session';

/**
 * Mimics generateResponseFromTools in src/core/server.js
 */
async function generateResponse(userMessage, toolResults, history) {
    const contextSummary = JSON.stringify(getContextSummary()).substring(0, 1000);
    const resultsSummary = JSON.stringify(toolResults, null, 2);

    const messages = [
        {
            role: "system",
            content: `You are a helpful, knowledgeable Be3 shopping assistant.
            
STORE CONTEXT:
${contextSummary}

TOOL RESULTS (Data sourced for this query):
${resultsSummary}

INSTRUCTIONS:
1. Answer the user's question using the TOOL RESULTS.
2. If tools returned an error (like ECONNREFUSED), acknowledge it gracefully but try to answer with what you know.
3. Be concise and friendly.`
        },
        ...history.slice(-3).map(h => ({
            role: h.role === 'ai' ? 'assistant' : 'user',
            content: h.text
        })),
        { role: "user", content: userMessage }
    ];

    return await queryAI(messages, 512);
}

async function runConversationalTurn(userMessage) {
    console.log(`\n👤 USER: "${userMessage}"`);

    const state = await stateManager.getState(SESSION_ID);

    // 1. SELECT TOOLS
    console.log('🧠 AI THINKING (Tool Selection)...');
    const tools = await selectTools(userMessage, state.conversation_history);

    if (tools.length > 0) {
        process.stdout.write('   Selected: ');
        console.log(tools.map(t => `${t.tool} (${t.reason || 'no reason'})`).join(' -> '));
    } else {
        console.log('   Selected: [] (Pure conversation)');
    }

    // 2. EXECUTE TOOLS
    let results = [];
    if (tools.length > 0) {
        console.log('⚙️  EXECUTING TOOLS...');
        results = await executeTools(tools, SESSION_ID);
        results.forEach(r => {
            const status = r.success ? '✅ Success' : '❌ Failed';
            console.log(`   - ${r.tool}: ${status} ${!r.success ? `(${r.error || 'Unknown error'})` : ''}`);
        });
    }

    // 3. GENERATE RESPONSE
    console.log('🤖 GENERATING RESPONSE...');
    const response = await generateResponse(userMessage, results, state.conversation_history);

    console.log(`🤖 AI: "${response.trim()}"`);

    // 4. UPDATE HISTORY
    await stateManager.addMessage(SESSION_ID, 'user', userMessage);
    await stateManager.addMessage(SESSION_ID, 'ai', response);
}

async function startConversation() {
    console.log('=====================================================');
    console.log('🚀 INITIALIZING DYNAMIC CONVERSATIONAL TEST');
    console.log('=====================================================');

    await stateManager.clearState(SESSION_ID);

    const messages = [
        "Hi there! What can you do for me?",
        "Show me some smartphones from Apple",
        "Add the first one to my cart",
        "Actually, show me something from Tayes",
        "I want to checkout my cart",
        "Set delivery to express",
        "Place the order now",
        "Actually, cancel my last order #12345"
    ];

    for (const msg of messages) {
        await runConversationalTurn(msg);
        // Small delay for realism
        await new Promise(r => setTimeout(r, 1000));
    }

    console.log('\n=====================================================');
    console.log('✅ TEST COMPLETE');
    console.log('=====================================================');
}

startConversation().catch(err => {
    console.error('Test Crashed:', err);
    process.exit(1);
});
