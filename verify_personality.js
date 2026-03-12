const { generateResponseFromTools } = require('./src/core/personalityLayer');

async function testPersonality() {
    console.log('Testing Personality Layer...');
    const userMessage = 'show me phones';
    const toolResults = [
        {
            tool: 'product.search',
            success: true,
            result: {
                products: [
                    { name: 'iPhone 15', price: 999, whatsapp_link: 'https://wa.me/123' },
                    { name: 'Samsung S23', price: 899, whatsapp_link: 'https://wa.me/456' }
                ]
            }
        }
    ];
    const conversationHistory = [{ role: 'user', text: 'hi' }, { role: 'ai', text: 'Hello! How can I help you today?' }];

    try {
        const reply = await generateResponseFromTools(userMessage, toolResults, conversationHistory);
        console.log('AI Reply:', reply);
        if (reply && reply.length > 0) {
            console.log('✅ Personality layer test passed!');
        } else {
            console.error('❌ Personality layer returned empty response.');
        }
    } catch (err) {
        console.error('❌ Personality layer test failed:', err.message);
    }
}

testPersonality();
