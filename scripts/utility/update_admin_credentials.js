const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

async function updateAdminCredentials() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const userId = '73a517ea-a1d4-45cf-bf38-a1abf143803e';
    const newEmail = 'lets.connectbro@gmail.com';
    const newPassword = 'Connect41!';

    const supabase = createClient(supabaseUrl, serviceKey);

    try {
        console.log(`Updating Auth for user ID: ${userId}...`);
        
        // 1. Update Auth Email and Password
        const { data: authUser, error: authError } = await supabase.auth.admin.updateUserById(
            userId,
            { email: newEmail, password: newPassword, email_confirm: true }
        );

        if (authError) {
            console.error('Auth update failed:', authError.message);
            return;
        }
        console.log('Auth updated successfully.');

        // 2. Update Admins table
        console.log(`Updating public.admins table...`);
        const { error: adminError } = await supabase
            .from('admins')
            .update({ email: newEmail })
            .eq('id', userId);

        if (adminError) {
            console.error('Admin table update failed:', adminError.message);
        } else {
            console.log('Admin table updated successfully.');
        }

        // 3. Verify in profiles table (if triggers exist)
        const { data: profileData } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', userId)
            .single();
        
        if (profileData) {
            console.log('Profile sync check:', profileData.email === newEmail ? 'SYNCED' : 'NOT SYNCED');
        }

    } catch (error) {
        console.error('Fatal error:', error.message);
    }
}

updateAdminCredentials();
