const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function patch() {
    const email = 'sefovov819@flownue.com';
    const { data: user } = await supabase.from('users').select('id').eq('email', email).single();
    if (!user) return console.error('User not found');
    
    const freelancerId = user.id;
    const { data: client } = await supabase.from('users').select('id').eq('role', 'CLIENT').limit(1).single();
    if (!client) return console.error('Client not found');
    
    // Create a Job
    const { data: job } = await supabase.from('jobs').insert([{
        client_id: client.id,
        title: 'Cloud Infrastructure Upgrade',
        description: 'Modernizing the internal cloud infra.',
        project_type: 'HOURLY',
        budget: 45,
        status: 'OPEN'
    }]).select().single();
    
    // Create an active Contract
    const { error } = await supabase.from('contracts').insert([{
        job_id: job.id,
        client_id: client.id,
        freelancer_id: freelancerId,
        status: 'ACTIVE',
        agreed_rate: 45,
        project_type: 'HOURLY',
        start_date: new Date()
    }]);

    if (error) console.error('Patch error:', error);
    else console.log('Mock Hourly Contract successfully injected for', email);
}

patch();
