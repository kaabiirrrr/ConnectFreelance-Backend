-- Connect.com Master Admin Setup Migration (v2 - More Robust)
-- This script creates all necessary tables and policies for Advanced Admin Features

-- 0. Ensure UUID extension exists
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Create Admins table
-- Stores admin users and their specific roles
CREATE TABLE IF NOT EXISTS public.admins (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT UNIQUE NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('SUPER_ADMIN', 'MODERATOR', 'FINANCE_ADMIN', 'SUPPORT_ADMIN')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Extend Profiles table for Verification & Featured status
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='verification_status') THEN
        ALTER TABLE public.profiles ADD COLUMN verification_status TEXT DEFAULT 'NOT_SUBMITTED';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='verification_documents') THEN
        ALTER TABLE public.profiles ADD COLUMN verification_documents JSONB DEFAULT '[]';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='verified_at') THEN
        ALTER TABLE public.profiles ADD COLUMN verified_at TIMESTAMP WITH TIME ZONE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='is_featured') THEN
        ALTER TABLE public.profiles ADD COLUMN is_featured BOOLEAN DEFAULT FALSE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='featured_until') THEN
        ALTER TABLE public.profiles ADD COLUMN featured_until TIMESTAMP WITH TIME ZONE;
    END IF;
END $$;

-- 3. Create Admin Activity Logs table
CREATE TABLE IF NOT EXISTS public.admin_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    admin_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    action_type TEXT NOT NULL,
    target_id TEXT,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. Create Withdrawals table
CREATE TABLE IF NOT EXISTS public.withdrawals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    amount DECIMAL(12, 2) NOT NULL,
    status TEXT DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
    payment_method JSONB,
    requested_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    processed_at TIMESTAMP WITH TIME ZONE,
    processed_by UUID REFERENCES auth.users(id)
);

-- 5. Create Platform Settings table
-- Dropping and recreating to ensure correct column names (avoiding 'key' name collision)
DROP TABLE IF EXISTS public.platform_settings;
CREATE TABLE public.platform_settings (
    setting_key TEXT PRIMARY KEY,
    setting_value JSONB NOT NULL,
    description TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Seed default commission
INSERT INTO public.platform_settings (setting_key, setting_value)
VALUES ('commission_percentage', '10')
ON CONFLICT (setting_key) DO NOTHING;

-- 6. Create Skills table
CREATE TABLE IF NOT EXISTS public.skills (
    id SERIAL PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    category TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 7. Create Announcements table
CREATE TABLE IF NOT EXISTS public.announcements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    target_role TEXT DEFAULT 'ALL' CHECK (target_role IN ('ALL', 'FREELANCER', 'CLIENT')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id)
);

-- 8. Enable RLS on all tables
ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.withdrawals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;

-- 9. Add RLS Policies (Dropping existing ones first to avoid duplicates)
DO $$ 
BEGIN
    -- Admin Logs
    DROP POLICY IF EXISTS "Admins can view all logs" ON public.admin_logs;
    CREATE POLICY "Admins can view all logs" ON public.admin_logs FOR SELECT USING (EXISTS (SELECT 1 FROM public.admins WHERE id = auth.uid()));
    
    DROP POLICY IF EXISTS "Admins can insert logs" ON public.admin_logs;
    CREATE POLICY "Admins can insert logs" ON public.admin_logs FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM public.admins WHERE id = auth.uid()));

    -- Announcements
    DROP POLICY IF EXISTS "Everyone can view announcements" ON public.announcements;
    CREATE POLICY "Everyone can view announcements" ON public.announcements FOR SELECT USING (TRUE);
    
    DROP POLICY IF EXISTS "Admins can create announcements" ON public.announcements;
    CREATE POLICY "Admins can create announcements" ON public.announcements FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM public.admins WHERE id = auth.uid()));

    -- Withdrawals
    DROP POLICY IF EXISTS "Users can view own withdrawals" ON public.withdrawals;
    CREATE POLICY "Users can view own withdrawals" ON public.withdrawals FOR SELECT USING (auth.uid() = user_id OR EXISTS (SELECT 1 FROM public.admins WHERE id = auth.uid()));
    
    DROP POLICY IF EXISTS "Admins can process withdrawals" ON public.withdrawals;
    CREATE POLICY "Admins can process withdrawals" ON public.withdrawals FOR UPDATE USING (EXISTS (SELECT 1 FROM public.admins WHERE id = auth.uid()));

    -- Skills
    DROP POLICY IF EXISTS "Everyone can view skills" ON public.skills;
    CREATE POLICY "Everyone can view skills" ON public.skills FOR SELECT USING (TRUE);
    
    DROP POLICY IF EXISTS "Admins can manage skills" ON public.skills;
    CREATE POLICY "Admins can manage skills" ON public.skills FOR ALL USING (EXISTS (SELECT 1 FROM public.admins WHERE id = auth.uid()));

    -- Platform Settings
    DROP POLICY IF EXISTS "Admins can manage settings" ON public.platform_settings;
    CREATE POLICY "Admins can manage settings" ON public.platform_settings FOR ALL USING (EXISTS (SELECT 1 FROM public.admins WHERE id = auth.uid()));
END $$;
