const supabase = require('./supabase/adminClient');

async function debugWorkspace(jobId) {
    console.log('--- DB DIAGNOSTIC ---');
    console.log('Job ID:', jobId);
    
    // 1. Check job_members
    const { data: members, error: mErr } = await supabase
        .from('job_members')
        .select('*')
        .eq('job_id', jobId);
    
    console.log('job_members count:', members?.length || 0);
    if (mErr) console.error('job_members error:', mErr);
    if (members?.length > 0) console.log('Sample Member:', members[0]);

    // 2. Check contracts
    const { data: contracts, error: cErr } = await supabase
        .from('contracts')
        .select('*')
        .eq('job_id', jobId);
    
    console.log('contracts count:', contracts?.length || 0);
    if (cErr) console.error('contracts error:', cErr);
    if (contracts?.length > 0) console.log('Sample Contract:', contracts[0]);

    // 3. Test the exact query logic from jobsController
    const { data: fallbackMembers, error: fErr } = await supabase
        .from('contracts')
        .select('id, freelancer_id, status, created_at')
        .eq('job_id', jobId)
        .eq('status', 'ACTIVE');
    
    console.log('Fallback query count (active only):', fallbackMembers?.length || 0);
    if (fErr) console.error('Fallback query error:', fErr);
}

// User's Job UUID from browser console logs
debugWorkspace('851dbcff-0b4b-449f-be88-10166ab250a6');
