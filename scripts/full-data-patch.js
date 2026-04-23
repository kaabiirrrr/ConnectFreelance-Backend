const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function patch() {
    const userId = '6947ed08-36c5-4ce5-a339-d72b2622b90d';
    const clientId = '3538ce9d-f2a7-4995-8e5f-31b1c2b117a7';
    
    console.log('1. Ensuring freelancer profile exists...');
    const { error: fError } = await supabase.from('freelancers').upsert([{
        id: userId,
        title: 'Fullstack Professional',
        bio: 'Expert in modern web technologies.',
        categories: ['Software Development'],
        skills: ['React', 'Node.js'],
        hourly_rate: 55
    }]);
    if (fError) return console.error('Freelancer error:', fError);

    console.log('2. Creating mock job...');
    const { data: job, error: jError } = await supabase.from('jobs').insert([{
        client_id: clientId,
        title: 'Platform Infrastructure Engineering',
        description: 'Ongoing work on the main platform features.',
        project_type: 'HOURLY',
        budget: 45,
        status: 'OPEN'
    }]).select().single();
    if (jError) return console.error('Job error:', jError);

    console.log('3. Creating active Hourly contract...');
    const { error: cError } = await supabase.from('contracts').insert([{
        job_id: job.id,
        client_id: clientId,
        freelancer_id: userId,
        status: 'ACTIVE',
        agreed_rate: 45,
        project_type: 'HOURLY',
        start_date: new Date()
    }]);
    if (cError) return console.error('Contract error:', cError);

    console.log('--- ALL STEPS SUCCESSFUL ---');
}

patch();
