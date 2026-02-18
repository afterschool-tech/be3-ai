const axios = require('axios');

async function testZeroAI() {
    try {
        const response = await axios.post('http://localhost:3005/chat', {
            message: "show me cheap smartphones",
            session_id: "test_zero_ai_session"
        });

        console.log('=== RESPONSE ===');
        console.log('Reply:', response.data.reply);
        console.log('Intent Detected:', response.data.results[0].intent);
        console.log('Parameters:', response.data.results[0].params);
        console.log('Products Found:', response.data.results[0].result.products.length);
    } catch (error) {
        console.error('Error:', error.response ? error.response.data : error.message);
    }
}

testZeroAI();
