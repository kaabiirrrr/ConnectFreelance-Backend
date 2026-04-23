require('dotenv').config();
const adminClient = require('../supabase/adminClient');

async function listFreelancers() {
    try {
        console.log('--- Fetching Freelancers ---');
        const { data, error } = await adminClient
            .from('profiles')
            .select('role, email, name')
            .eq('role', 'FREELANCER')
            .limit(5);
        
        if (error) {
            console.error('Error fetching freelancers:', error);
        } else {
            console.log('Freelancer Accounts:', JSON.stringify(data, null, 2));
        }
    } catch (err) {
        console.error('Fatal error:', err);
    }
}

listFreelancers();
