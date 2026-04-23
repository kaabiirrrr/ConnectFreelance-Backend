const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, serviceKey);

async function cleanupAdmin() {
    const adminEmail = 'lets.connectbro@gmail.com';

    try {
        console.log(`Starting cleanup for ${adminEmail}...`);

        // 1. Get user ID
        const { data: { users }, error: authError } = await supabase.auth.admin.listUsers();
        if (authError) throw authError;

        const adminUser = users.find(u => u.email === adminEmail);
        if (!adminUser) {
            console.log('Admin user not found in Auth. Nothing to clean.');
            return;
        }

        const userId = adminUser.id;
        console.log(`Found User ID: ${userId}`);

        // 2. Delete from profiles
        const { error: profileError } = await supabase
            .from('profiles')
            .delete()
            .eq('id', userId);
        
        if (profileError) {
            console.error('Error deleting from profiles:', profileError.message);
        } else {
            console.log('Successfully removed from profiles table.');
        }

        // 3. Delete from users table (if it's being used as a redundant role table)
        const { error: userTableError } = await supabase
            .from('users')
            .delete()
            .eq('id', userId);
        
        if (userTableError) {
            console.error('Error deleting from users table:', userTableError.message);
        } else {
            console.log('Successfully removed from users table.');
        }

        // 4. Ensure exists in admins table
        const { data: adminRecord, error: adminQueryError } = await supabase
            .from('admins')
            .select('*')
            .eq('id', userId)
            .single();

        if (adminQueryError && adminQueryError.code !== 'PGRST116') {
            console.error('Error querying admins table:', adminQueryError.message);
        }

        if (!adminRecord) {
            console.log('Admin record missing. Creating SUPER_ADMIN record...');
            const { error: insertError } = await supabase
                .from('admins')
                .insert({ id: userId, email: adminEmail, role: 'SUPER_ADMIN' });
            
            if (insertError) {
                console.error('Error inserting into admins table:', insertError.message);
            } else {
                console.log('Successfully created SUPER_ADMIN record.');
            }
        } else {
            console.log(`Admin record exists with role: ${adminRecord.role}`);
            if (adminRecord.role !== 'SUPER_ADMIN') {
                console.log('Updating role to SUPER_ADMIN...');
                await supabase.from('admins').update({ role: 'SUPER_ADMIN' }).eq('id', userId);
            }
        }

        console.log('Cleanup complete.');

    } catch (error) {
        console.error('Fatal cleanup error:', error.message);
    }
}

cleanupAdmin();
