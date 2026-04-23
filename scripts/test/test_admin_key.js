require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

async function testAdmin() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    console.log('Testing Supabase Admin connection...');
    console.log('URL:', supabaseUrl);
    console.log('Key exists:', !!supabaseKey);

    const supabase = createClient(supabaseUrl, supabaseKey);

    try {
        const { data, error } = await supabase.auth.admin.listUsers({
            limit: 1
        });

        if (error) {
            console.error('Admin API Error:', error.message);
            console.error('Hint: Make sure SUPABASE_SERVICE_ROLE_KEY is correct and has admin privileges.');
            process.exit(1);
        }

        console.log('✅ Admin connection successful!');
        console.log('Admin user list working, found users:', data.users.length);
        process.exit(0);
    } catch (err) {
        console.error('Fatal Error:', err.message);
        process.exit(1);
    }
}

testAdmin();
