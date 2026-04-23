const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, serviceKey);

async function forceSetup() {
    console.log('--- Force Admin Setup & Cleanup ---');

    // 1. Force Cleanup for lets.connectbro@gmail.com
    const superAdminEmail = 'lets.connectbro@gmail.com';
    const { data: { users: authUsers } } = await supabase.auth.admin.listUsers({ perPage: 1000 });
    const superAdmin = authUsers.find(u => u.email === superAdminEmail);
    if (superAdmin) {
        console.log(`Cleaning up ${superAdminEmail} (ID: ${superAdmin.id})...`);
        const { error: pErr } = await supabase.from('profiles').delete().eq('user_id', superAdmin.id);
        const { error: uErr } = await supabase.from('users').delete().eq('id', superAdmin.id);
        console.log('Profile cleanup:', pErr ? pErr.message : 'SUCCESS');
        console.log('User table cleanup:', uErr ? uErr.message : 'SUCCESS');
        
        // Ensure in admins table
        await supabase.from('admins').upsert({ id: superAdmin.id, email: superAdminEmail, role: 'SUPER_ADMIN' });
    }

    // 2. Setup kabirmore8904@gmail.com
    const targetEmail = 'kabirmore8904@gmail.com';
    const targetPassword = 'Connect41';
    console.log(`\nAttempting setup for ${targetEmail}...`);

    let targetUser = authUsers.find(u => u.email.toLowerCase() === targetEmail.toLowerCase());
    
    if (!targetUser) {
        console.log(`Creating ${targetEmail} in Auth...`);
        const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
            email: targetEmail,
            password: targetPassword,
            email_confirm: true
        });

        if (createError) {
            console.error('Create error:', createError.message);
            if (createError.message.includes('already been registered')) {
                console.log('CRITICAL: Supabase says registered but listUsers missed it. Trying to find by ID if I can guess or searching more thoroughly...');
                // One more list with a different page size
                const { data: { users: retryUsers } } = await supabase.auth.admin.listUsers({ perPage: 50 });
                targetUser = retryUsers.find(u => u.email.toLowerCase() === targetEmail.toLowerCase());
            }
        } else {
            targetUser = newUser.user;
            console.log('Created successfully.');
        }
    }

    if (targetUser) {
        console.log(`Setting up DB for ${targetEmail} (ID: ${targetUser.id})...`);
        await supabase.from('profiles').delete().eq('user_id', targetUser.id);
        await supabase.from('users').delete().eq('id', targetUser.id);
        const { error } = await supabase.from('admins').upsert({
            id: targetUser.id,
            email: targetEmail,
            role: 'SUPER_ADMIN'
        });
        console.log('Admin table registration:', error ? error.message : 'SUCCESS');
    } else {
        console.log(`FAILED to find or create ${targetEmail}.`);
    }
}

forceSetup();
