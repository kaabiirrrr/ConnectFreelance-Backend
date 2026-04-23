const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function listAdmins() {
    const { data, error } = await supabase
        .from('admins')
        .select('*');

    if (error) {
        console.error('Error fetching admins:', error);
        return;
    }

    console.log('Admin Accounts stored in "admins" table:');
    console.table(data);
}

listAdmins();
