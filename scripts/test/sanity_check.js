const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

async function sanityCheck() {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    console.log('--- SUPABASE SANITY CHECK ---');
    console.log('URL:', url);
    console.log('Key length:', key?.length);
    console.log('Key prefix:', key?.substring(0, 10));

    const supabase = createClient(url, key);

    // 1. PROJECT INFO (Check if we can list buckets or something to verify project)
    const { data: buckets, error: bucketError } = await supabase.storage.listBuckets();
    if (bucketError) {
        console.error('Storage connectivity error:', bucketError.message);
    } else {
        console.log('Connected to project with buckets:', buckets.map(b => b.name));
    }

    // 2. CHECK TARGET ADMIN
    const adminEmail = 'lets.connectbro@gmail.com';
    console.log(`\nChecking tables for ${adminEmail}:`);

    const { data: authUsers } = await supabase.auth.admin.listUsers({ perPage: 1000 });
    const authUser = authUsers.users.find(u => u.email === adminEmail);
    if (authUser) {
        console.log('Auth User ID:', authUser.id);
        
        const { data: adminRecord } = await supabase.from('admins').select('*').eq('id', authUser.id);
        console.log('Admins Table Match:', adminRecord?.length ? 'YES' : 'NO', adminRecord?.[0]?.role);

        const { data: profileRecord } = await supabase.from('profiles').select('*').eq('id', authUser.id);
        console.log('Profiles Table Match:', profileRecord?.length ? 'YES' : 'NO', profileRecord?.[0]?.role);
    } else {
        console.log('Auth user NOT FOUND.');
    }

    // 3. SEARCH FOR MISSING ADMIN
    const missingEmail = 'kabirmore8904@gmail.com';
    console.log(`\nSearching for ${missingEmail} in ALL Auth users:`);
    const { data: allAuthUsers } = await supabase.auth.admin.listUsers({ perPage: 1000 });
    const found = allAuthUsers.users.find(u => u.email.toLowerCase() === missingEmail.toLowerCase());
    if (found) {
        console.log('Found missing admin in Auth! ID:', found.id);
    } else {
        console.log('Missing admin NOT FOUND in Auth.');
        console.log('Emails present:', allAuthUsers.users.map(u => u.email));
    }
}

sanityCheck();
