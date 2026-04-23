const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
    const freelancer_id = '6947ed08-36c5-4ce5-a339-d72b2622b90d';
    const client_id = '3538ce9d-f2a7-4995-8e5f-31b1c2b117a7';
    
    console.log('Creating mock job...');
    const { data: job, error: jError } = await supabase.from('jobs').insert([{
        client_id: client_id,
        title: 'Fullstack Platform Enhancement',
        description: 'Ongoing maintenance and feature additions for the main platform.',
        project_type: 'HOURLY',
        budget: 45,
        status: 'OPEN',
        category: 'Software Development'
    }]).select().single();
    
    if (jError) {
        console.error('Job error:', jError);
        return;
    }
    
    console.log('Creating mock contract...');
    const { data: contract, error: cError } = await supabase.from('contracts').insert([{
        job_id: job.id,
        client_id: client_id,
        freelancer_id: freelancer_id,
        status: 'ACTIVE',
        agreed_rate: 45,
        project_type: 'HOURLY',
        start_date: new Date().toISOString()
    }]).select().single();
    
    if (cError) {
        console.error('Contract error:', cError);
        return;
    }
    
    console.log('Mock Hourly Contract Created successfully!');
}

run();
