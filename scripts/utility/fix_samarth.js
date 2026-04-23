const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function fixSamarth() {
    const email = 'samarthshendge20@gmail.com';
    console.log(`Fixing role for: ${email}\n`);

    // 1. Find the user ID
    const { data: { users } } = await supabase.auth.admin.listUsers();
    const user = users.find(u => u.email.toLowerCase() === email.toLowerCase());

    if (!user) {
        console.error('❌ User not found in Auth');
        return;
    }

    const userId = user.id;

    // 2. Check Admins Table
    const { data: admin } = await supabase.from('admins').select('*').eq('id', userId).maybeSingle();
    if (!admin) {
        console.log('➕ Adding record to admins table...');
        await supabase.from('admins').insert([{ id: userId, email, role: 'ADMIN', name: 'Samarth Shendge' }]);
    } else if (admin.role !== 'ADMIN') {
        console.log('🔄 Updating role in admins table...');
        await supabase.from('admins').update({ role: 'ADMIN' }).eq('id', userId);
    } else {
        console.log('✅ Admins table is correct');
    }

    // 3. Delete from Profiles to let it be recreated correctly or update it to ADMIN
    console.log('🔄 Fixing profiles table...');
    const { data: profile } = await supabase.from('profiles').select('*').eq('user_id', userId).maybeSingle();
    
    if (profile) {
        console.log('Found profile, deleting it so it can be recreated correctly on next login.');
        await supabase.from('profiles').delete().eq('user_id', userId);
    }
    
    // Also cleanup by email just in case
    await supabase.from('profiles').delete().eq('email', email);

    console.log('\n🎉 Fix applied! Please try logging in again.');
}

fixSamarth();
