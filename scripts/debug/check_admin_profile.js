const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

async function checkSuperAdminProfile() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const supabase = createClient(supabaseUrl, serviceKey);

    const adminId = '73a517ea-a1d4-45cf-bf38-a1abf143803e';

    try {
        console.log(`Checking profile for admin ID: ${adminId}`);
        const { data, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', adminId)
            .single();
        
        if (error) {
            console.error('Error fetching admin profile:', error.message);
            
            // Check if it exists in admins table at least
            const { data: adminRaw } = await supabase.from('admins').select('*').eq('id', adminId).single();
            console.log('Exists in admins table:', !!adminRaw);
            if (adminRaw) console.log('Admin data:', adminRaw);

            return;
        }

        console.log('Super Admin Profile Data:');
        console.log(JSON.stringify(data, null, 2));

    } catch (error) {
        console.error('Fatal error:', error.message);
    }
}

checkSuperAdminProfile();
