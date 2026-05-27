-- Migration: Realtime Presence & Activity Status Tracking System
-- Created: 2026-05-27

-- 1. Create User Presence Table
CREATE TABLE IF NOT EXISTS public.user_presence (
    user_id uuid PRIMARY KEY,
    status text NOT NULL DEFAULT 'offline', -- 'online', 'active', 'idle', 'offline', 'dormant'
    last_active timestamptz DEFAULT now(),
    last_seen timestamptz DEFAULT now(),
    current_page text,
    device_info jsonb DEFAULT '{}'::jsonb, -- OS, Browser, Screen size
    ip_address text,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- 2. Create Admin Presence Table (Tracks custom moderator/admin modules)
CREATE TABLE IF NOT EXISTS public.admin_presence (
    admin_id uuid PRIMARY KEY REFERENCES public.admins(id) ON DELETE CASCADE,
    status text NOT NULL DEFAULT 'offline', -- 'online', 'reviewing', 'moderating', 'finance', 'idle', 'inactive'
    last_active timestamptz DEFAULT now(),
    current_module text, -- 'KYC', 'Disputes', 'Treasury', 'FAQ', 'Command Center'
    mfa_verified boolean DEFAULT false,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- 3. Create Active Sessions Table
CREATE TABLE IF NOT EXISTS public.active_sessions (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid,
    socket_id text NOT NULL UNIQUE,
    ip_address text,
    user_agent text,
    device_type text, -- 'desktop', 'mobile', 'tablet'
    login_source text, -- 'google', 'email', 'apple'
    created_at timestamptz DEFAULT now(),
    last_ping_at timestamptz DEFAULT now()
);

-- 4. Create Session History Table (For security logging & auditing)
CREATE TABLE IF NOT EXISTS public.session_history (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid,
    login_at timestamptz NOT NULL DEFAULT now(),
    logout_at timestamptz,
    ip_address text,
    user_agent text,
    duration_seconds integer,
    termination_reason text -- 'user_logout', 'force_revoke', 'timeout', 'disconnect'
);

-- 5. Create Presence Events Table (For activity analytics & heatmaps)
CREATE TABLE IF NOT EXISTS public.presence_events (
    id bigserial PRIMARY KEY,
    user_id uuid,
    event_type text NOT NULL, -- 'login', 'logout', 'idle_start', 'idle_end', 'page_view'
    page_url text,
    created_at timestamptz DEFAULT now()
);

-- 6. Indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_presence_status ON public.user_presence(status);
CREATE INDEX IF NOT EXISTS idx_admin_presence_status ON public.admin_presence(status);
CREATE INDEX IF NOT EXISTS idx_active_sessions_user_id ON public.active_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_session_history_user_id ON public.session_history(user_id);
CREATE INDEX IF NOT EXISTS idx_presence_events_user_id ON public.presence_events(user_id);
CREATE INDEX IF NOT EXISTS idx_presence_events_created_at ON public.presence_events(created_at);

-- 7. Enable RLS on new tables (bypassed by service role, locked from public)
ALTER TABLE public.user_presence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_presence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.active_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.presence_events ENABLE ROW LEVEL SECURITY;
