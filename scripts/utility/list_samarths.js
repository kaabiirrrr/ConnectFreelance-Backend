const supabase = require('./supabase/client');
const adminClient = require('./supabase/adminClient');
require('dotenv').config();

async function listAllSamarths() {
    const email = 'samarthshendge20@gmail.com';
    const password = 'StanadarAdmin41!'; // Correct password from history
    const idToLookup = '51127d40-508e-4580-8b24-48174299c653';
    
    // 0. Check lookup BEFORE sign in
    console.log('--- Lookup BEFORE Sign In (Global Client) ---');
    const { data: before, error: errBefore } = await supabase.from('admins').select('*').eq('id', idToLookup).maybeSingle();
    console.log('Result:', before ? `FOUND (Role: ${before.role})` : 'NOT FOUND', errBefore || '');

    console.log('--- Lookup BEFORE Sign In (Admin Client) ---');
    const { data: bAdmin, error: ebAdmin } = await adminClient.from('admins').select('*').eq('id', idToLookup).maybeSingle();
    console.log('Result:', bAdmin ? `FOUND (Role: ${bAdmin.role})` : 'NOT FOUND', ebAdmin || '');

    // 1. Login to get a token
    console.log(`\nSimulating login for ${email}...`);
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ email, password });
    
    if (authError) {
        console.error('Login Failed:', authError.message);
        return;
    }
    console.log('✅ Login Success!');

    // 2. Check lookup AFTER sign in 
    console.log('\n--- Lookup AFTER Sign In (Global Client - SHOULD BE POLLUTED) ---');
    const { data: after, error: errAfter } = await supabase.from('admins').select('*').eq('id', idToLookup).maybeSingle();
    console.log('Result:', after ? `FOUND (Role: ${after.role})` : 'NOT FOUND', errAfter || '');

    console.log('--- Lookup AFTER Sign In (Admin Client - SHOULD BE CLEAN) ---');
    const { data: aAdmin, error: eaAdmin } = await adminClient.from('admins').select('*').eq('id', idToLookup).maybeSingle();
    console.log('Result:', aAdmin ? `FOUND (Role: ${aAdmin.role})` : 'NOT FOUND', eaAdmin || '');
}

listAllSamarths();
