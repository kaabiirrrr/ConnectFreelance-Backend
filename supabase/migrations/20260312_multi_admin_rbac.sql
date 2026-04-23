-- Connect.com Multi-Admin RBAC Migration

-- 1. Create Admins table (if not exists)
CREATE TABLE IF NOT EXISTS public.admins (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email TEXT UNIQUE NOT NULL,
    role TEXT NOT NULL DEFAULT 'ADMIN' CHECK (role IN ('SUPER_ADMIN', 'ADMIN')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Ensure the SUPER_ADMIN role exists in the check constraint if we just created it
-- (though the above already has it)

-- 2. Update/Create Admin Activity Logs table
CREATE TABLE IF NOT EXISTS public.admin_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    admin_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    admin_email TEXT,
    action_type TEXT NOT NULL,
    target_type TEXT,
    target_id TEXT,
    description TEXT,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add missing columns to admin_logs if it already existed
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='admin_logs' AND column_name='admin_email') THEN
        ALTER TABLE public.admin_logs ADD COLUMN admin_email TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='admin_logs' AND column_name='target_type') THEN
        ALTER TABLE public.admin_logs ADD COLUMN target_type TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='admin_logs' AND column_name='timestamp') THEN
        ALTER TABLE public.admin_logs ADD COLUMN timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW();
    END IF;
END $$;

-- 3. Initial Super Admin Recognition
-- Insert the existing Super Admin if not already present
-- Use a subquery to get the ID from auth.users if they are already registered
INSERT INTO public.admins (id, email, role)
SELECT id, email, 'SUPER_ADMIN'
FROM auth.users
WHERE email = 'lets.connectbro@gmail.com'
ON CONFLICT (email) DO UPDATE SET role = 'SUPER_ADMIN';

-- 4. Enable RLS
ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_logs ENABLE ROW LEVEL SECURITY;

-- 5. Basic Policies (Only Super Admins can manage admins)
DROP POLICY IF EXISTS "Super Admins can manage admins" ON public.admins;
CREATE POLICY "Super Admins can manage admins" ON public.admins
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.admins 
            WHERE id = auth.uid() AND role = 'SUPER_ADMIN'
        )
    );

DROP POLICY IF EXISTS "Admins can view their own record" ON public.admins;
CREATE POLICY "Admins can view their own record" ON public.admins
    FOR SELECT USING (id = auth.uid());

DROP POLICY IF EXISTS "Super Admins can view all logs" ON public.admin_logs;
CREATE POLICY "Super Admins can view all logs" ON public.admin_logs
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.admins 
            WHERE id = auth.uid() AND role = 'SUPER_ADMIN'
        )
    );

DROP POLICY IF EXISTS "Admins can insert logs" ON public.admin_logs;
CREATE POLICY "Admins can insert logs" ON public.admin_logs
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.admins 
            WHERE id = auth.uid()
        )
    );
