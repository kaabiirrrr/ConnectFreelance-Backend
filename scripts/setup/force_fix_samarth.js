const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function finalDataFix() {
    const email = 'samarthshendge20@gmail.com';
    const userId = '51127d40-508e-4580-8b24-48174299c653';

    console.log(`Force fixing role for ${email} (ID: ${userId})...`);

    // 1. Ensure ADMINS table is correct
    const { error: adminError } = await supabase
        .from('admins')
        .upsert({ id: userId, email, role: 'ADMIN', name: 'Samarth Shendge' });
    
    if (adminError) console.error('Admin Upsert Error:', adminError.message);
    else console.log('✅ Admins table forced to ADMIN');

    // 2. Ensure PROFILES table is correct
    const { error: profileError } = await supabase
        .from('profiles')
        .upsert({ 
            id: userId, 
            email, 
            role: 'ADMIN', 
            name: 'Samarth Shendge',
            profile_completed: true,
            profile_completion_percentage: 100
        });
    
    if (profileError) console.error('Profile Upsert Error:', profileError.message);
    else console.log('✅ Profiles table forced to ADMIN');

    console.log('\nData fix complete. Next login WILL work as ADMIN.');
}

finalDataFix();
