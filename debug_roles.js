const adminClient = require('./supabase/adminClient');

async function check() {
    // 1. Check all jobs in team mode
    const { data: teamJobs, error: jobsErr } = await adminClient
        .from('jobs')
        .select('id, title, job_mode')
        .eq('job_mode', 'team');

    if (jobsErr) {
        console.error('Error fetching jobs:', jobsErr.message);
        return;
    }

    console.log(`Found ${teamJobs?.length || 0} team jobs.`);

    // 2. Check roles for these jobs
    if (teamJobs && teamJobs.length > 0) {
        const jobIds = teamJobs.map(j => j.id);
        const { data: roles, error: rolesErr } = await adminClient
            .from('job_roles')
            .select('*')
            .in('job_id', jobIds);
        
        if (rolesErr) {
            console.error('Error fetching roles:', rolesErr.message);
        } else {
            console.log(`Found ${roles?.length || 0} roles total for these jobs.`);
            roles.forEach(r => {
                console.log(`Role: ${r.title} (JobID: ${r.job_id})`);
            });
        }
    }
}

check();
