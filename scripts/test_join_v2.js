const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function testJoinUsers() {
    console.log('🔍 Testing Join with Users...');
    const { error } = await supabase
        .from('identity_verifications')
        .select('*, users!user_id(email)')
        .limit(1);

    if (error) console.error('❌ USERS JOIN FAILED:', error.message);
    else console.log('✅ USERS JOIN SUCCESSFUL!');
}

async function testJoinProfiles() {
    console.log('🔍 Testing Join with Profiles...');
    const { error } = await supabase
        .from('identity_verifications')
        .select('*, profiles!user_id(name)')
        .limit(1);

    if (error) console.error('❌ PROFILES JOIN FAILED:', error.message);
    else console.log('✅ PROFILES JOIN SUCCESSFUL!');
}

async function run() {
    await testJoinUsers();
    await testJoinProfiles();
}

run();
