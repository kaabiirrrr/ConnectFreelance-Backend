const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: './.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function check() {
    const { data, error } = await supabase.storage.listBuckets();
    if (error) {
        console.error('Error fetching buckets:', error);
    } else {
        console.log('Available buckets:', data.map(b => b.name));
    }
}
check();
