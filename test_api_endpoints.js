const axios = require('axios');
const adminClient = require('./supabase/adminClient');
const supabase = require('./supabase/client');

async function testApiEndpoints() {
    const email = 'kabirmore8904@gmail.com';
    const userId = '8272917d-d670-4977-8251-06cb2b1c4098';
    const password = 'Connect41!';

    console.log('=== LOGGING IN ===');
    let token = '';
    try {
        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password
        });
        if (error) throw error;
        token = data.session.access_token;
        console.log('Login successful. Token:', token.substring(0, 15) + '...');
    } catch (err) {
        console.error('Login failed:', err.message);
        return;
    }

    const api = axios.create({
        baseURL: 'http://localhost:5001',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    });

    const jobId = '5b7ec13c-909e-45b0-a83b-8a054c0d7ca8';
    
    // Test getWorkspaceData
    try {
        console.log('\n--- GET /api/jobs/' + jobId + '/workspace ---');
        const res = await api.get(`/api/jobs/${jobId}/workspace`);
        console.log('Workspace data response status:', res.status);
        console.log('Workspace data response:', JSON.stringify(res.data, null, 2));
    } catch (err) {
        console.error('Workspace API failed:', err.response?.status, err.response?.data || err.message);
    }

    // Test getSkimmerOverview
    try {
        console.log('\n--- GET /api/skimmer/' + jobId + '/overview ---');
        const res = await api.get(`/api/skimmer/${jobId}/overview`);
        console.log('Skimmer overview response:', JSON.stringify(res.data, null, 2));
    } catch (err) {
        console.error('Skimmer overview failed:', err.response?.status, err.response?.data || err.message);
    }

    // Test getSkimmerTasks
    try {
        console.log('\n--- GET /api/skimmer/' + jobId + '/tasks ---');
        const res = await api.get(`/api/skimmer/${jobId}/tasks`);
        console.log('Skimmer tasks response:', JSON.stringify(res.data, null, 2));
    } catch (err) {
        console.error('Skimmer tasks failed:', err.response?.status, err.response?.data || err.message);
    }

    // Test getSkimmerInsights
    try {
        console.log('\n--- GET /api/skimmer/' + jobId + '/insights ---');
        const res = await api.get(`/api/skimmer/${jobId}/insights`);
        console.log('Skimmer insights response:', JSON.stringify(res.data, null, 2));
    } catch (err) {
        console.error('Skimmer insights failed:', err.response?.status, err.response?.data || err.message);
    }
}

testApiEndpoints();
