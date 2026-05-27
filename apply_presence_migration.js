/**
 * Apply the realtime presence system migration to Supabase.
 * Run with: node apply_presence_migration.js
 */
require('dotenv').config();
const adminClient = require('./supabase/adminClient');

const SQL = `
-- 1. User Presence Table
CREATE TABLE IF NOT EXISTS public.user_presence (
    user_id uuid PRIMARY KEY,
    status text NOT NULL DEFAULT 'offline',
    last_active timestamptz DEFAULT now(),
    last_seen timestamptz DEFAULT now(),
    current_page text,
    device_info jsonb DEFAULT '{}'::jsonb,
    ip_address text,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- 2. Admin Presence Table
CREATE TABLE IF NOT EXISTS public.admin_presence (
    admin_id uuid PRIMARY KEY,
    status text NOT NULL DEFAULT 'offline',
    last_active timestamptz DEFAULT now(),
    current_module text,
    mfa_verified boolean DEFAULT false,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- 3. Active Sessions Table
CREATE TABLE IF NOT EXISTS public.active_sessions (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid,
    socket_id text NOT NULL UNIQUE,
    ip_address text,
    user_agent text,
    device_type text,
    login_source text,
    created_at timestamptz DEFAULT now(),
    last_ping_at timestamptz DEFAULT now()
);

-- 4. Session History Table
CREATE TABLE IF NOT EXISTS public.session_history (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid,
    login_at timestamptz NOT NULL DEFAULT now(),
    logout_at timestamptz,
    ip_address text,
    user_agent text,
    duration_seconds integer,
    termination_reason text
);

-- 5. Presence Events Table
CREATE TABLE IF NOT EXISTS public.presence_events (
    id bigserial PRIMARY KEY,
    user_id uuid,
    event_type text NOT NULL,
    page_url text,
    created_at timestamptz DEFAULT now()
);

-- 6. Indexes
CREATE INDEX IF NOT EXISTS idx_user_presence_status ON public.user_presence(status);
CREATE INDEX IF NOT EXISTS idx_admin_presence_status ON public.admin_presence(status);
CREATE INDEX IF NOT EXISTS idx_active_sessions_user_id ON public.active_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_session_history_user_id ON public.session_history(user_id);
CREATE INDEX IF NOT EXISTS idx_presence_events_user_id ON public.presence_events(user_id);
CREATE INDEX IF NOT EXISTS idx_presence_events_created_at ON public.presence_events(created_at);

-- 7. Enable RLS (service role bypasses it automatically)
ALTER TABLE public.user_presence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_presence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.active_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.presence_events ENABLE ROW LEVEL SECURITY;
`;

async function run() {
    console.log('Applying presence system migration...\n');

    // Try via exec_sql RPC first
    const { error: rpcError } = await adminClient.rpc('exec_sql', { sql: SQL });

    if (!rpcError) {
        console.log('✅ Migration applied successfully via RPC.');
        process.exit(0);
    }

    // RPC not available — fall back to running each statement individually
    if (rpcError.code === 'PGRST202' || rpcError.message?.includes('exec_sql')) {
        console.warn('exec_sql RPC not available, trying statement-by-statement...\n');

        const statements = SQL
            .split(';')
            .map(s => s.trim())
            .filter(s => s.length > 0 && !s.startsWith('--'));

        let failed = 0;
        for (const stmt of statements) {
            // Supabase JS client can't run raw DDL directly — print for manual run
            console.log('  >', stmt.split('\n')[0].substring(0, 80));
        }

        console.log('\n⚠️  The exec_sql RPC function is not available in your Supabase project.');
        console.log('Please run the following SQL manually in your Supabase SQL Editor:\n');
        console.log('  File: backend/migrations/20260527_realtime_presence_system.sql\n');
        console.log('Steps:');
        console.log('  1. Open https://supabase.com/dashboard');
        console.log('  2. Go to your project → SQL Editor');
        console.log('  3. Paste the contents of the migration file and click Run\n');
        process.exit(1);
    }

    console.error('❌ Migration failed:', rpcError.message);
    console.error('Full error:', JSON.stringify(rpcError, null, 2));
    process.exit(1);
}

run();
