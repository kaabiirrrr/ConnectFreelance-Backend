const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const adminClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
    const { data: freelancer, error: fError } = await adminClient.from('profiles').select('*').eq('role', 'FREELANCER').limit(1).single();
    if (fError) {
        console.error('Freelancer Error:', fError);
        return;
    }
    console.log('Freelancer skills:', freelancer.skills, typeof freelancer.skills, Array.isArray(freelancer.skills));
    console.log('Freelancer category:', freelancer.category);

    const { data: jobs, error: jError } = await adminClient.from('jobs').select('id, title, skills, category').eq('status', 'OPEN');
    if (jError) {
        console.error('Job Error:', jError);
        return;
    }
    console.log('Open jobs count:', jobs.length);
    if (jobs.length > 0) {
        console.log('Job 1 skills:', jobs[0].skills, typeof jobs[0].skills, Array.isArray(jobs[0].skills));
        console.log('Job 1 category:', jobs[0].category);
    }

    const { data: recs } = await adminClient.from('job_recommendations').select('freelancer_id, job_id, match_score');
    console.log('Job recs count:', recs?.length);
    if (recs?.length > 0) {
        console.log('First rec:', recs[0]);
    }
}
run();
