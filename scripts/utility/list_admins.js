const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function listAdmins() {
    const { data: admins, error } = await supabase.from('admins').select('*');
    if (error) {
        console.error('Error fetching admins:', error);
        return;
    }

    console.log(`Found ${admins.length} admins:\n`);
    admins.forEach((a, i) => {
        console.log(`Admin ${i+1}:`);
        console.log(`  ID: ${a.id}`);
        console.log(`  Email: ${a.email}`);
        console.log(`  Role: ${a.role}`);
        console.log('---');
    });
}

listAdmins();
