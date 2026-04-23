const supabase = require('../supabase/adminClient');

async function dedupeAndLock() {
    console.log('--- DE-DUPLICATION & DATABASE LOCK INITIATED ---');

    // 1. Find potential duplicates
    const { data: proposals, error: fetchError } = await supabase
        .from('proposals')
        .select('id, job_id, freelancer_id, created_at')
        .order('created_at', { ascending: false });

    if (fetchError) {
        console.error('Error fetching proposals:', fetchError);
        return;
    }

    const seen = new Set();
    const toDelete = [];

    proposals.forEach(p => {
        const key = `${p.job_id}|${p.freelancer_id}`;
        if (seen.has(key)) {
            toDelete.push(p.id);
        } else {
            seen.add(key);
        }
    });

    console.log(`Found ${toDelete.length} duplicate proposals to prune.`);

    if (toDelete.length > 0) {
        const { error: delError } = await supabase
            .from('proposals')
            .delete()
            .in('id', toDelete);
        
        if (delError) {
            console.error('Pruning failed:', delError);
            return;
        }
        console.log('Duplicates pruned successfully.');
    }

    // 2. Add Unique Constraint
    console.log('Applying UNIQUE (freelancer_id, job_id) constraint...');
    const { error: sqlError } = await supabase.rpc('execute_sql', {
        sql_query: `
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'unique_freelancer_job') THEN
                    ALTER TABLE public.proposals ADD CONSTRAINT unique_freelancer_job UNIQUE (freelancer_id, job_id);
                END IF;
            END $$;
        `
    });

    if (sqlError) {
        console.error('SQL Constraint failed (Note: This might require manual DB console execution if RPC is disabled):', sqlError);
    } else {
        console.log('Database locked! One-bid-per-job enforced.');
    }
}

dedupeAndLock();
