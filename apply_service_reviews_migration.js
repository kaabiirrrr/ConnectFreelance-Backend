/**
 * Service Reviews Migration Runner
 * 
 * This script applies the service_reviews migration to your Supabase project.
 * 
 * HOW TO RUN:
 *   node apply_service_reviews_migration.js
 * 
 * If the automatic method fails (no exec_sql RPC), it will print the SQL
 * for you to paste into the Supabase SQL Editor at:
 *   https://supabase.com/dashboard/project/ogtkjtbvbkyddutnmcov/sql/new
 */

require('dotenv').config();
const adminClient = require('./supabase/adminClient');

const MIGRATION_SQL = `
-- Step 1: Add reviews_count column to services (if not exists)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'services' AND column_name = 'reviews_count'
  ) THEN
    ALTER TABLE public.services ADD COLUMN reviews_count INTEGER DEFAULT 0;
  END IF;
END $$;

-- Step 2: Create service_reviews table
CREATE TABLE IF NOT EXISTS public.service_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_id UUID NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
    order_id UUID NOT NULL REFERENCES public.service_orders(id) ON DELETE CASCADE,
    client_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    comment TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(order_id)
);

CREATE INDEX IF NOT EXISTS idx_service_reviews_service_id ON public.service_reviews(service_id);
CREATE INDEX IF NOT EXISTS idx_service_reviews_client_id ON public.service_reviews(client_id);

-- Step 3: Trigger to auto-update services.rating and services.reviews_count
CREATE OR REPLACE FUNCTION public.update_service_rating()
RETURNS TRIGGER AS $func$
DECLARE
    sid UUID;
    new_avg DECIMAL(3,2);
    new_count INTEGER;
BEGIN
    sid := COALESCE(NEW.service_id, OLD.service_id);
    SELECT COALESCE(AVG(rating), 0)::DECIMAL(3,2), COUNT(*)::INTEGER
    INTO new_avg, new_count
    FROM public.service_reviews WHERE service_id = sid;
    UPDATE public.services SET rating = new_avg, reviews_count = new_count WHERE id = sid;
    RETURN NEW;
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_update_service_rating ON public.service_reviews;
CREATE TRIGGER trigger_update_service_rating
AFTER INSERT OR UPDATE OR DELETE ON public.service_reviews
FOR EACH ROW EXECUTE FUNCTION public.update_service_rating();
`;

async function run() {
    console.log('Checking if service_reviews table already exists...');

    const { error: checkErr } = await adminClient
        .from('service_reviews')
        .select('id')
        .limit(1);

    if (!checkErr) {
        console.log('✅ service_reviews table already exists. Nothing to do.');
        process.exit(0);
    }

    if (checkErr.code !== '42P01' && checkErr.code !== 'PGRST205') {
        console.error('Unexpected error checking table:', checkErr.message);
    }

    console.log('Table does not exist. Attempting migration via exec_sql RPC...');

    const { error: rpcErr } = await adminClient.rpc('exec_sql', { sql: MIGRATION_SQL });

    if (!rpcErr) {
        console.log('✅ Migration applied successfully via RPC!');
        process.exit(0);
    }

    // RPC not available — print manual instructions
    console.log('\n❌ Automatic migration failed (exec_sql RPC not available).');
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('MANUAL ACTION REQUIRED — Run this SQL in your Supabase SQL Editor:');
    console.log('👉  https://supabase.com/dashboard/project/ogtkjtbvbkyddutnmcov/sql/new');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log(MIGRATION_SQL);
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('The SQL is also saved at: backend/supabase/migrations/20260524_service_reviews.sql');
    process.exit(1);
}

run().catch(err => {
    console.error('Script error:', err.message);
    process.exit(1);
});
