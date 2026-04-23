const supabase = require('./supabase/client');

async function wipeAndReset() {
    console.log('🚀 Starting Full Database Wipe and Reset...');

    try {
        // 1. Clear Public Tables
        console.log('\n--- Phase 1: Public Tables ---');
        // Order matters due to foreign keys. Child tables first.
        const tables = [
            'admin_logs',
            'contracts',
            'proposals',
            'jobs',
            'messages',
            'conversation_participants',
            'conversations',
            'notifications',
            'teams',
            'subscriptions',
            'withdrawals',
            'reviews',
            'skills',
            'announcements',
            'profiles',
            'admins'
        ];

        for (const table of tables) {
            console.log(`Clearing table: ${table}...`);
            const { error: clearError } = await supabase
                .from(table)
                .delete()
                .neq('id', '00000000-0000-0000-0000-000000000000'); 

            if (clearError) {
                if (clearError.code === 'PGRST205') {
                    console.log(`ℹ️ Table ${table} does not exist in schema. Skipping.`);
                } else {
                    console.error(`Error clearing ${table}:`, clearError.message);
                }
            } else {
                console.log(`✅ Table ${table} cleared.`);
            }
        }

        // 2. Delete all Auth Users
        console.log('\n--- Phase 2: Authentication ---');
        const { data: { users }, error: listError } = await supabase.auth.admin.listUsers();
        
        if (listError) {
            console.error('Error listing users:', listError.message);
        } else {
            console.log(`Found ${users.length} users to delete.`);
            for (const user of users) {
                const { error: deleteError } = await supabase.auth.admin.deleteUser(user.id);
                if (deleteError) {
                    console.error(`Failed to delete user ${user.email}:`, deleteError.message);
                } else {
                    console.log(`Deleted user: ${user.email}`);
                }
            }
        }

        // 3. Create New Super Admin
        console.log('\n--- Phase 3: Fresh Super Admin ---');
        const NEW_SUPER_ADMIN_EMAIL = 'lets.connectbro@gmail.com';
        const NEW_SUPER_ADMIN_PASS = 'Connect@123';

        console.log(`Creating fresh Super Admin: ${NEW_SUPER_ADMIN_EMAIL}...`);
        const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
            email: NEW_SUPER_ADMIN_EMAIL,
            password: NEW_SUPER_ADMIN_PASS,
            email_confirm: true,
            user_metadata: { full_name: 'Super Admin' }
        });

        if (authError) {
            console.error('Error creating Super Admin auth record:', authError.message);
            return;
        }

        console.log('Auth record created. Syncing to admins table...');
        
        const { error: adminError } = await supabase
            .from('admins')
            .insert({
                id: authUser.user.id,
                email: NEW_SUPER_ADMIN_EMAIL,
                role: 'SUPER_ADMIN',
                name: 'Super Admin'
            });

        if (adminError) {
            console.error('Error creating admin record:', adminError.message);
        } else {
            console.log('✅ Super Admin created successfully!');
        }

        console.log('\n✨ Database Wipe and Reset Complete! ✨');

    } catch (err) {
        console.error('FATAL ERROR during wipe:', err.message);
    }
}

wipeAndReset();
