const axios = require('axios');

const BACKEND_URL = process.env.BACKEND_API_URL || 'http://localhost:3000';
const TENANT_ID = process.env.TENANT_ID || 'cbe1df05-45ed-455a-9ce6-156b0bd45713';

/**
 * Universal helper to make backend API calls with tenant context.
 * @param {string} endpoint - API endpoint starting with /
 * @param {object} options - Axios-style options
 */
async function callBackendAPI(endpoint, options = {}) {
    try {
        const config = {
            method: options.method || 'GET',
            ...options,
            headers: {
                'X-Tenant-ID': TENANT_ID,
                'Content-Type': 'application/json',
                ...options.headers
            }
        };

        const url = `${BACKEND_URL}${endpoint}`;
        // Only log significantly different calls or errors, or debug mode
        // console.log(`[API] ${config.method} ${url}`);

        const response = await axios({ url, ...config });
        return { success: true, data: response.data };
    } catch (error) {
        if (error.code === 'ECONNREFUSED' || (error.message && error.message.includes('ECONNREFUSED'))) {
            throw new Error(`Backend Connection Refused: Ensure the main server is running at ${BACKEND_URL}`);
        }

        const errorMsg = error.response?.data?.message || error.message;
        console.error(`[API Error] ${endpoint}: ${errorMsg}`);
        return { success: false, error: errorMsg };
    }
}

module.exports = {
    callBackendAPI,
    BACKEND_URL,
    TENANT_ID
};
