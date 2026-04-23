const axios = require('axios');

async function testLogin() {
    const email = 'lets.connectbro@gmail.com';
    const password = 'Connect41!';
    const url = 'http://localhost:5001/api/auth/login';

    try {
        console.log(`Testing login for ${email}...`);
        const response = await axios.post(url, { email, password });
        console.log('Login Result:', JSON.stringify(response.data, null, 2));
    } catch (error) {
        console.error('Login Failed:');
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Data:', JSON.stringify(error.response.data, null, 2));
        } else {
            console.error('Error Message:', error.message);
        }
    }
}

testLogin();
