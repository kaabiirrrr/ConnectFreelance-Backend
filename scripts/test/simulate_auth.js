const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function simulateAuth() {
    const email = 'samarthshendge20@gmail.com';
    const password = 'StanadarAdmin41!';

    console.log(`Simulating login for ${email}...`);
    
    // 1. Login to get a token
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ email, password });
    
    if (authError) {
        console.error('Login Failed:', authError.message);
        return;
    }

    const token = authData.session.access_token;
    const userId = authData.user.id;
    console.log(`✅ Login Success! ID: ${userId}`);
    console.log(`Token acquired. Length: ${token.length}`);

    // 2. Simulate Middleware logic
    console.log('\n--- Simulating Middleware ---');
    const { data: { user }, error: getUserError } = await supabase.auth.getUser(token);
    
    if (getUserError || !user) {
        console.error('getUser(token) Failed:', getUserError?.message || 'No user');
        return;
    }
    console.log(`✅ getUser(token) confirmed ID: ${user.id}`);

    // Let's see what IDs are actually in the table
    const { data: allAdmins, error: allErr } = await supabase.from('admins').select('id, email, role');
    console.log('\n--- All Admins in DB ---');
    console.log(allAdmins.map(a => `ID: "${a.id}" EMAIL: "${a.email}"`).join('\n'));
    
    const foundDirectly = allAdmins.find(a => a.id === user.id);
    console.log(`\nManual comparison find: ${foundDirectly ? 'FOUND' : 'NOT FOUND'}`);

    const { data: adminRecord, error: dbError } = await supabase
        .from('admins')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();

    if (dbError) {
        console.error('Admin Lookup Error:', JSON.stringify(dbError));
    } else if (!adminRecord) {
        console.warn('❌ NO ADMIN RECORD FOUND explicitly by ID!');
    } else {
        console.log('✅ ADMIN RECORD FOUND:', adminRecord.role);
    }
}

simulateAuth();
