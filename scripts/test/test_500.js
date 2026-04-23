const axios = require('axios');
require('dotenv').config();

const API_URL = 'http://localhost:5001';

async function testEndpoint(path) {
    console.log(`\nTesting ${path}...`);
    try {
        // We don't even need a valid token to see if it's 401 vs 500
        // But let's assume we want to see the 500
        const response = await axios.get(`${API_URL}${path}`, {
            headers: { Authorization: 'Bearer invalid-but-well-formed-token-xyz' }
        });
        console.log(`Success:`, response.data);
    } catch (error) {
        if (error.response) {
            console.log(`Error ${error.response.status}:`, JSON.stringify(error.response.data, null, 2));
        } else {
            console.log(`Error:`, error.message);
        }
    }
}

async function run() {
    await testEndpoint('/api/admin/users');
    await testEndpoint('/api/admin/jobs');
    await testEndpoint('/api/admin/proposals');
}

run();
