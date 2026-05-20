const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const adminClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
    const { data: profiles } = await adminClient.from('profiles').select('user_id, name, skills, category, step_data').eq('role', 'FREELANCER');
    console.log(profiles.map(p => ({
        id: p.user_id,
        name: p.name,
        skills: p.skills,
        stepSkills: p.step_data?.skills,
        cat: p.category
    })));
}
run();
