const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

async function fixSuperAdminProfile() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const supabase = createClient(supabaseUrl, serviceKey);

    const adminId = '73a517ea-a1d4-45cf-bf38-a1abf143803e';
    const email = 'lets.connectbro@gmail.com';
    const role = 'SUPER_ADMIN';
    const name = 'Admin';

    try {
        console.log(`Fixing profile for admin ID: ${adminId}`);
        
        // Use upsert to create or update
        const { data, error } = await supabase
            .from('profiles')
            .upsert([
                { 
                    id: adminId, 
                    email: email, 
                    role: role, 
                    name: name,
                    profile_completed: true 
                }
            ]);
        
        if (error) {
            console.error('Error fixing admin profile:', error.message);
            return;
        }

        console.log('Super Admin profile fixed successfully!');

    } catch (error) {
        console.error('Fatal error:', error.message);
    }
}

fixSuperAdminProfile();
