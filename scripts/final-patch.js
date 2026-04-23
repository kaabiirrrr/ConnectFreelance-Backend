const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function patch() {
    const freelancerId = '6947ed08-36c5-4ce5-a339-d72b2622b90d';
    const clientId = '3538ce9d-f2a7-4995-8e5f-31b1c2b117a7';
    
    console.log('Injecting active hourly contract for testing...');
    
    // 1. Create a Job
    const { data: job, error: jError } = await supabase.from('jobs').insert([{
        client_id: clientId,
        title: 'Fullstack Platform Enhancement',
        description: 'Ongoing work on the main platform features.',
        project_type: 'HOURLY',
        budget: 45,
        status: 'OPEN'
    }]).select().single();
    
    if (jError) return console.error('Job error:', jError);

    // 2. Create an active Contract
    const { error: cError } = await supabase.from('contracts').insert([{
        job_id: job.id,
        client_id: clientId,
        freelancer_id: freelancerId,
        status: 'ACTIVE',
        agreed_rate: 45,
        project_type: 'HOURLY',
        start_date: new Date()
    }]);

    if (cError) console.error('Contract error:', cError);
    else console.log('Mock Hourly Contract successfully injected!');
}

patch();
