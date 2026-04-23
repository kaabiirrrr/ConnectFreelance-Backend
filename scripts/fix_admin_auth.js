const supabase = require('../supabase/client');
const bcrypt = require('bcryptjs');
const SALT_ROUNDS = 10;

async function fixAdminAuth() {
    const admins = [
        { email: 'kabirmore8904@gmail.com', password: 'Connect41!' },
        { email: 'lets.connectbro@gmail.com', password: 'Connect41!' }
    ];

    console.log(`[Fix] Attempting to set password and sync tables for admins...`);

    try {
        const { data: { users: authUsers }, error: listError } = await supabase.auth.admin.listUsers();
        if (listError) throw listError;

        for (const admin of admins) {
            const user = authUsers.find(u => u.email === admin.email);
            if (!user) {
                console.warn(`[Warn] User with email ${admin.email} not found in Supabase Auth.`);
                continue;
            }

            const userId = user.id;
            console.log(`[Fix] Syncing ${admin.email} (ID: ${userId})`);

            // 1. Update Auth
            await supabase.auth.admin.updateUserById(userId, {
                password: admin.password,
                email_confirm: true
            });

            // 2. Hash password for DB storage
            const hashedPassword = await bcrypt.hash(admin.password, SALT_ROUNDS);

            // 3. Sync admins table
            await supabase.from('admins').upsert({ 
                id: userId, 
                email: admin.email, 
                role: 'SUPER_ADMIN', 
                name: 'Admin',
                password_hash: hashedPassword
            });

            // 3. REMOVE from profiles and users (so they are ONLY in admins table)
            // This prevents the "CLIENT" fallback logic in authController.js from kicking in
            console.log(`[Fix] Removing ${admin.email} from users and profiles fallbacks...`);
            await supabase.from('profiles').delete().eq('user_id', userId);
            await supabase.from('users').delete().eq('id', userId);

            console.log(`[Success] ${admin.email} is now a SUPER_ADMIN with no CLIENT fallback.`);
        }

        console.log(`[Fix] All done. Please try logging in again.`);

    } catch (error) {
        console.error('[Error] Failed to fix admin auth:', error.message);
    }
}

fixAdminAuth();
