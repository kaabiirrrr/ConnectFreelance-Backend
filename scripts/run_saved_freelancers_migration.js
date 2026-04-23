require('dotenv').config();
const adminClient = require('../supabase/adminClient');

async function run() {
    console.log('Checking users table name...');

    // First verify what the users table is called
    const { data: users, error: usersErr } = await adminClient
        .from('users')
        .select('id')
        .limit(1);

    if (usersErr) {
        console.error('Cannot access users table:', usersErr.message);
        console.log('Check your Supabase Table Editor for the correct table name.');
        process.exit(1);
    }

    console.log('users table OK. Running migration via rpc...');

    const sql = `
        CREATE TABLE IF NOT EXISTS public.client_saved_freelancers (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            client_id UUID NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
            freelancer_id UUID NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT client_saved_freelancers_client_freelancer_unique UNIQUE (client_id, freelancer_id),
            CONSTRAINT client_saved_freelancers_no_self_save CHECK (client_id <> freelancer_id)
        );

        CREATE INDEX IF NOT EXISTS idx_client_saved_freelancers_client_id
            ON public.client_saved_freelancers (client_id);

        CREATE INDEX IF NOT EXISTS idx_client_saved_freelancers_freelancer_id
            ON public.client_saved_freelancers (freelancer_id);

        ALTER TABLE public.client_saved_freelancers ENABLE ROW LEVEL SECURITY;

        DROP POLICY IF EXISTS "Clients read own saved freelancers" ON public.client_saved_freelancers;
        CREATE POLICY "Clients read own saved freelancers"
            ON public.client_saved_freelancers FOR SELECT
            USING (auth.uid() = client_id);

        DROP POLICY IF EXISTS "Clients insert own saved freelancers" ON public.client_saved_freelancers;
        CREATE POLICY "Clients insert own saved freelancers"
            ON public.client_saved_freelancers FOR INSERT
            WITH CHECK (auth.uid() = client_id);

        DROP POLICY IF EXISTS "Clients delete own saved freelancers" ON public.client_saved_freelancers;
        CREATE POLICY "Clients delete own saved freelancers"
            ON public.client_saved_freelancers FOR DELETE
            USING (auth.uid() = client_id);
    `;

    const { error } = await adminClient.rpc('exec_sql', { sql });

    if (error) {
        console.error('Migration failed via rpc:', error.message);
        console.log('\nFallback: Run this SQL manually in Supabase SQL Editor:');
        console.log(sql);
        process.exit(1);
    }

    console.log('Migration complete. Verifying...');

    const { data, error: verifyErr } = await adminClient
        .from('client_saved_freelancers')
        .select('id')
        .limit(1);

    if (verifyErr) {
        console.error('Verification failed:', verifyErr.message);
    } else {
        console.log('Table client_saved_freelancers is ready.');
    }
}

run();
