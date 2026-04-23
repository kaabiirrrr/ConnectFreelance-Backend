const adminClient = require('./supabase/adminClient');

async function syncExistingContracts() {
    console.log('--- ENTERPRISE WORKSPACE SYNC START ---');
    
    // 1. Fetch all active contracts
    const { data: contracts, error: cErr } = await adminClient
        .from('contracts')
        .select(`
            id, job_id, freelancer_id, client_id, status, created_at,
            job:jobs(title)
        `)
        .eq('status', 'ACTIVE');

    if (cErr) {
        console.error('Error fetching contracts:', cErr);
        return;
    }

    console.log(`Found ${contracts.length} active contracts. checking sync state...`);

    for (const contract of contracts) {
        // 2. Check if already in job_members
        const { data: member } = await adminClient
            .from('job_members')
            .select('id')
            .eq('job_id', contract.job_id)
            .eq('user_id', contract.freelancer_id)
            .maybeSingle();

        if (!member) {
            console.log(`Syncing freelancer ${contract.freelancer_id} for job "${contract.job?.title || contract.job_id}"...`);
            
            // 3. Insert into job_members
            const { error: mErr } = await adminClient
                .from('job_members')
                .insert([{
                    job_id: contract.job_id,
                    user_id: contract.freelancer_id,
                    role: 'Freelancer',
                    role_normalized: 'freelancer',
                    scope: 'Mission parameters inherited from contract.',
                    is_lead: true, // Mark as lead since they are the first synced
                    added_by: contract.client_id,
                    status: 'active',
                    joined_at: contract.created_at
                }]);

            if (mErr) {
                console.error(`  - Failed to sync: ${mErr.message}`);
            } else {
                console.log(`  - Success.`);
            }
        }
    }

    console.log('--- SYNC COMPLETE ---');
}

syncExistingContracts();
