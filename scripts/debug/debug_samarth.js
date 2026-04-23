const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function debugAdmin() {
    const email = 'samarthshendge20@gmail.com';
    console.log(`Checking database state for: ${email}\n`);

    // 1. Check Auth
    const { data: { users }, error: authError } = await supabase.auth.admin.listUsers();
    const authUser = users.find(u => u.email.toLowerCase() === email.toLowerCase());
    
    if (authUser) {
        console.log('--- AUTH USER ---');
        console.log('ID:', authUser.id);
        console.log('Email:', authUser.email);
        console.log('Metadata:', authUser.user_metadata);
    } else {
        console.log('❌ Auth user NOT FOUND');
    }

    // 2. Check Admins Table
    const { data: adminRecords, error: adminError } = await supabase
        .from('admins')
        .select('*')
        .ilike('email', email);
    
    console.log('\n--- ADMINS TABLE ---');
    if (adminRecords?.length) {
        console.log(adminRecords);
    } else {
        console.log('❌ No records found in admins table');
    }

    // 3. Check Profiles Table
    const { data: profileRecords, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('email', email);
    
    console.log('\n--- PROFILES TABLE (by email) ---');
    if (profileRecords?.length) {
        console.log(profileRecords);
    } else {
        console.log('❌ No records found in profiles table by email');
    }

    if (authUser) {
        const { data: profileRecordById } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', authUser.id);
        
        console.log('\n--- PROFILES TABLE (by id) ---');
        if (profileRecordById?.length) {
            console.log(profileRecordById);
        } else {
            console.log('❌ No records found in profiles table by id');
        }
    }
}

debugAdmin();
