const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const adminClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
    const { data: freelancer } = await adminClient.from('profiles').select('user_id, skills, category, step_data').eq('role', 'FREELANCER').limit(1).single();
    console.log('Freelancer id:', freelancer.user_id);
    console.log('Freelancer skills:', freelancer.skills);
    console.log('Freelancer category:', freelancer.category);
    console.log('Freelancer step_data:', JSON.stringify(freelancer.step_data, null, 2));
}
run();
