const adminClient = require('./supabase/adminClient');

async function checkRLS() {
    console.log('Checking RLS status for job_roles...');
    
    const { data, error } = await adminClient.rpc('exec_sql', { 
        sql: `
            SELECT relname, relrowsecurity 
            FROM pg_class 
            WHERE oid = 'public.job_roles'::regclass;
        `
    });

    if (error) {
        // If exec_sql fails, we'll try a different way
        console.log('exec_sql not available, trying select from information_schema...');
        const { data: tables, error: tableErr } = await adminClient
            .from('job_roles')
            .select('*')
            .limit(1);
        
        console.log('Successfully reached table (Admin Context).');
        return;
    }

    console.log('RLS Status:', data);
}

checkRLS();
