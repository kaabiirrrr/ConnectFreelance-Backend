require('dotenv').config();
const adminClient = require('./supabase/adminClient');

async function test() {
    try {
        console.log('--- Checking identity_verifications table ---');
        const { data, error, count } = await adminClient
            .from('identity_verifications')
            .select('*', { count: 'exact' });
        
        if (error) {
            console.error('Error fetching identity_verifications:', error);
        } else {
            console.log(`Found ${data.length} records (Total count: ${count})`);
            console.log('Data:', JSON.stringify(data, null, 2));
        }

        console.log('\n--- Checking profiles with pending status ---');
        const { data: profiles, error: pError } = await adminClient
            .from('profiles')
            .select('id, name, verification_status')
            .eq('verification_status', 'pending');
        
        if (pError) {
            console.error('Error fetching profiles:', pError);
        } else {
            console.log(`Found ${profiles.length} profiles with pending status`);
            console.log('Profiles:', profiles);
        }
    } catch (err) {
        console.error('Fatal error:', err);
    }
}

test();
