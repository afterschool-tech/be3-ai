const axios = require('axios');

async function verifyServer() {
    console.log('Verifying Server /chat endpoint...');
    const API_URL = 'http://localhost:3005';
    const SESSION_ID = 'verify_server_' + Date.now();

    try {
        const res = await axios.post(`${API_URL}/chat`, {
            message: 'hi',
            session_id: SESSION_ID
        });
        console.log('Server Reply:', res.data.reply);
        if (res.data.reply && res.data.reply.length > 0) {
            console.log('✅ Server refactor verified!');
        } else {
            console.error('❌ Server returned empty reply.');
        }
    } catch (err) {
        console.error('❌ Server verification failed:', err.response?.data || err.message);
        console.log('Make sure the server is running on port 3005.');
    }
}

verifyServer();
