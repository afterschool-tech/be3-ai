const axios = require('axios');
require('dotenv').config();

const API_URL = 'http://localhost:3005';
const SESSION_ID = 'inspection_' + Date.now();

async function chat(message) {
    const res = await axios.post(`${API_URL}/chat`, {
        message,
        session_id: SESSION_ID
    });
    console.log(`\nUser: "${message}"`);
    console.log(`AI: "${res.data.reply}"`);
}

async function run() {
    await chat("hii");
    await chat("Good morning! can you help me find something?");
    await chat("What's the best thing you can do for me today?");
}

run();
