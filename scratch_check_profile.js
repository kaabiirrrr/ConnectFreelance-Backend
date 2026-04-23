const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: './.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function check() {
    const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', '3946ff93-f4a9-4e6b-a354-d71ebd00ff6c')
        .maybeSingle();
    
    console.log('Profile:', data);
    console.log('Error:', error);
}

check();
