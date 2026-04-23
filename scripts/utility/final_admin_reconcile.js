const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, serviceKey);

const finalSetup = async () => {
    const admins = [
        { email: 'kabirmore8904@gmail.com', id: '9ba64e1d-31a0-4252-83a7-2e359130ad05', role: 'SUPER_ADMIN', password: 'Connect41' },
        { email: 'samarthshendge20@gmail.com', id: '7a14cd74-c48b-4a9d-9f4e-d412138e7275', role: 'ADMIN', password: 'Connect123!' },
        { email: 'rohanyp1592007@gmail.com', id: '0055db0d-f338-4c48-bb04-3f82e606818c', role: 'ADMIN', password: 'Connect123!' },
        { email: 'lets.connectbro@gmail.com', id: '73a517ea-a1d4-45cf-bf38-a1abf143803e', role: 'SUPER_ADMIN', password: null } // Password already set or managed
    ];

    console.log('--- FINAL ADMIN RECONCILIATION ---');

    for (const admin of admins) {
        console.log(`\nReconciling ${admin.email}...`);

        // 1. Update Password if provided
        if (admin.password) {
            console.log('Updating password...');
            const { error: passErr } = await supabase.auth.admin.updateUserById(admin.id, { password: admin.password });
            if (passErr) console.warn('Password update warning:', passErr.message);
        }

        // 2. Clear role conflicts
        await supabase.from('profiles').delete().eq('id', admin.id);
        await supabase.from('users').delete().eq('id', admin.id);
        console.log('Cleaned profiles/users table.');

        // 3. Ensure in admins table
        const { error: adminErr } = await supabase.from('admins').upsert({
            id: admin.id,
            email: admin.email,
            role: admin.role
        });
        if (adminErr) console.error('Admin upsert error:', adminErr.message);
        else console.log(`Registered as ${admin.role} in admins table.`);
    }

    console.log('\n--- ALL DONE ---');
};

finalSetup();
