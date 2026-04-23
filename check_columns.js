
const adminClient = require('./supabase/adminClient');

async function test() {
    console.log('--- Testing profiles table ---');
    const { data, error } = await adminClient
        .from('profiles')
        .select('*')
        .limit(1);
    
    if (error) {
        console.error('Error fetching profile:', error);
    } else {
        console.log('Successfully fetched profile keys:', Object.keys(data[0] || {}));
    }
}

test();
