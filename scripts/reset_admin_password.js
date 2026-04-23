const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');
const SALT_ROUNDS = 10;
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const ADMIN_EMAIL = 'kabirmore8904@gmail.com';
const NEW_PASSWORD = 'AdminPassword123!';

async function resetAdminPassword() {
    console.log(`Attempting to reset password for: ${ADMIN_EMAIL}...`);

    // 1. Get user ID from email
    const { data: userData, error: userError } = await supabase.auth.admin.listUsers();

    if (userError) {
        console.error('Error listing users:', userError);
        return;
    }

    const user = userData.users.find(u => u.email === ADMIN_EMAIL);

    if (!user) {
        console.error(`User with email ${ADMIN_EMAIL} not found in Supabase Auth.`);
        return;
    }

    // 2. Update password
    const { error: updateError } = await supabase.auth.admin.updateUserById(
        user.id,
        { password: NEW_PASSWORD }
    );

    if (updateError) {
        console.error('Error updating password in Auth:', updateError);
        return;
    }

    // 3. Update password_hash in admins table
    const hashedPassword = await bcrypt.hash(NEW_PASSWORD, SALT_ROUNDS);
    const { error: dbError } = await supabase
        .from('admins')
        .update({ password_hash: hashedPassword, updated_at: new Date().toISOString() })
        .eq('id', user.id);

    if (dbError) {
        console.error('Error updating password_hash in database:', dbError);
        return;
    }

    console.log('--------------------------------------------------');
    console.log('SUCCESS: Admin password has been reset.');
    console.log(`Email: ${ADMIN_EMAIL}`);
    console.log(`New Password: ${NEW_PASSWORD}`);
    console.log('--------------------------------------------------');
}

resetAdminPassword();
