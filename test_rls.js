const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY; // Use ANON key to simulate freelancer

const supabase = createClient(supabaseUrl, supabaseKey);

async function testVisibility() {
    console.log('Testing role visibility for anonymous/freelancer user...');
    
    // 1. Get first team job
    const { data: job, error: jobErr } = await supabase
        .from('jobs')
        .select('id, title, job_mode')
        .eq('status', 'OPEN')
        .eq('job_mode', 'team')
        .limit(1)
        .single();

    if (jobErr) {
        console.error('Error fetching job:', jobErr.message);
        return;
    }

    console.log(`Found Team Job: ${job.title} (${job.id})`);

    // 2. Try to fetch roles for this job
    const { data: roles, error: rolesErr } = await supabase
        .from('job_roles')
        .select('*')
        .eq('job_id', job.id);

    if (rolesErr) {
        console.error('Error fetching roles (POSSIBLE RLS ISSUE):', rolesErr.message);
    } else {
        console.log(`Successfully fetched ${roles?.length || 0} roles.`);
        if (roles?.length === 0) {
            console.warn('Roles array is EMPTY. Either they dont exist or RLS is blocking them silently (returning nothing).');
        }
    }
}

testVisibility();
