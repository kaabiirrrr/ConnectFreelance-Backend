require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log('Testing Anon Key:', anonKey ? anonKey.substring(0, 15) + '...' : 'MISSING');
console.log('Testing Service Key:', serviceKey ? serviceKey.substring(0, 15) + '...' : 'MISSING');

const anonClient = createClient(supabaseUrl, anonKey);
const adminClient = createClient(supabaseUrl, serviceKey);

async function runTest() {
    console.log('--- Testing Anon Client ---');
    const anonRes = await anonClient.from('profiles').select('user_id').limit(1);
    console.log('Anon Result:', anonRes.error ? anonRes.error.message : 'SUCCESS');

    console.log('--- Testing Admin Client ---');
    const adminRes = await adminClient.from('profiles').select('user_id').limit(1);
    console.log('Admin Result:', adminRes.error ? adminRes.error.message : 'SUCCESS');

    console.log('--- Testing Auth endpoint anon ---');
    const authRes = await anonClient.auth.signInWithPassword({email: 'test@invalid.com', password: 'password'});
    console.log('Auth Result:', authRes.error ? authRes.error.message : 'SUCCESS');
}

runTest();
