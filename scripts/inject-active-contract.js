const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
    const email = 'sefovov819@flownue.com';
    console.log(`Searching for user: ${email}...`);
    
    // 1. Get User ID
    const { data: user, error: uError } = await supabase.from('users').select('id').eq('email', email).single();
    if (uError) {
        console.error('User error:', uError);
        return;
    }
    const freelancer_id = user.id;
    console.log(`Found User ID: ${freelancer_id}`);

    // 2. Ensure Freelancer entry exists (foreign key constraint found earlier)
    console.log('Ensuring freelancer profile entry exists...');
    const { data: freelancerCheck } = await supabase.from('freelancers').select('id').eq('id', freelancer_id).single();
    if (!freelancerCheck) {
        console.log('Creating missing freelancer profile...');
        const { error: fError } = await supabase.from('freelancers').insert([{
            id: freelancer_id,
            title: 'Fullstack Professional',
            bio: 'Expert in modern web technologies.',
            categories: ['Software Development'],
            skills: ['React', 'Node.js', 'PostgreSQL'],
            hourly_rate: 50
        }]);
        if (fError) {
            console.error('Freelancer insert error:', fError);
            return;
        }
    }

    // 3. Find a Client
    console.log('Finding a client to link the contract...');
    const { data: client, error: cError } = await supabase.from('users').select('id').eq('role', 'CLIENT').limit(1).single();
    if (cError) {
        console.error('Client error:', cError);
        return;
    }
    const client_id = client.id;

    // 4. Create a Job
    console.log('Creating mock hourly job...');
    const { data: job, error: jError } = await supabase.from('jobs').insert([{
        client_id: client_id,
        title: 'Platform Infrastructure Engineering',
        description: 'Ongoing cloud and platform engineering tasks for the core service.',
        project_type: 'HOURLY',
        budget: 60,
        status: 'OPEN',
        category: 'Software Development'
    }]).select().single();
    if (jError) {
        console.error('Job error:', jError);
        return;
    }

    // 5. Create the Contract
    console.log('Creating mock active contract...');
    const { error: contractError } = await supabase.from('contracts').insert([{
        job_id: job.id,
        client_id: client_id,
        freelancer_id: freelancer_id,
        status: 'ACTIVE',
        agreed_rate: 60,
        project_type: 'HOURLY',
        start_date: new Date().toISOString()
    }]);
    if (contractError) {
        console.error('Contract insert error:', contractError);
        return;
    }

    console.log('--- SUCCESS ---');
    console.log(`An active hourly contract has been created for ${email}.`);
    console.log('The "Submit Work Log" button should now be fully active and workable!');
}

run();
