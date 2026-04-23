-- Connect.com Advanced Admin Features Migration

-- 1. Extend Profiles table for Verification & Featured status
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS verification_status TEXT DEFAULT 'NOT_SUBMITTED',
ADD COLUMN IF NOT EXISTS verification_documents JSONB DEFAULT '[]',
ADD COLUMN IF NOT EXISTS verified_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS is_featured BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS featured_until TIMESTAMP WITH TIME ZONE;

-- 2. Create Admin Activity Logs table
CREATE TABLE IF NOT EXISTS public.admin_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    admin_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    action_type TEXT NOT NULL,
    target_id TEXT,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Create Withdrawals table
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

-- 4. Create Platform Settings table
CREATE TABLE IF NOT EXISTS public.platform_settings (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Seed default commission
INSERT INTO public.platform_settings (key, value)
VALUES ('commission_percentage', '10')
ON CONFLICT (key) DO NOTHING;

-- 5. Create Skills table (Taxonomy)
CREATE TABLE IF NOT EXISTS public.skills (
    id SERIAL PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    category TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 6. Create Announcements table
CREATE TABLE IF NOT EXISTS public.announcements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    target_role TEXT DEFAULT 'ALL' CHECK (target_role IN ('ALL', 'FREELANCER', 'CLIENT')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id)
);

-- 7. Add RLS Policies (Basic Admin access)
-- Note: These should be refined based on actual RBAC requirements
ALTER TABLE public.admin_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.withdrawals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;

-- Simple policy: Only admins can view logs
CREATE POLICY "Admins can view all logs" ON public.admin_logs
    FOR SELECT USING (EXISTS (SELECT 1 FROM public.admins WHERE id = auth.uid()));

-- Add more policies as needed...
