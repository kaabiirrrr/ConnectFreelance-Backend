-- Migration: Enterprise RBAC System

-- 1. Extend existing admins table for enterprise features
ALTER TABLE public.admins
ADD COLUMN IF NOT EXISTS trust_score integer DEFAULT 100,
ADD COLUMN IF NOT EXISTS risk_score integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS mfa_enforced boolean DEFAULT false;

-- 2. Create Admin Roles Table (Dynamic Role Builder)
CREATE TABLE IF NOT EXISTS public.admin_roles (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    name text NOT NULL UNIQUE,
    description text,
    is_system boolean DEFAULT false, -- e.g., Super Admin role cannot be deleted
    risk_level text DEFAULT 'low', -- 'low', 'medium', 'critical'
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- 3. Create Admin Permissions Table
CREATE TABLE IF NOT EXISTS public.admin_permissions (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    module text NOT NULL,
    action text NOT NULL,
    description text,
    created_at timestamptz DEFAULT now(),
    UNIQUE(module, action)
);

-- 4. Create Role-Permissions Junction
CREATE TABLE IF NOT EXISTS public.admin_role_permissions (
    role_id uuid REFERENCES public.admin_roles(id) ON DELETE CASCADE,
    permission_id uuid REFERENCES public.admin_permissions(id) ON DELETE CASCADE,
    created_at timestamptz DEFAULT now(),
    PRIMARY KEY (role_id, permission_id)
);

-- 5. Create Admin-User-Roles Junction
CREATE TABLE IF NOT EXISTS public.admin_user_roles (
    admin_id uuid REFERENCES public.admins(id) ON DELETE CASCADE,
    role_id uuid REFERENCES public.admin_roles(id) ON DELETE CASCADE,
    assigned_by uuid REFERENCES public.admins(id) ON DELETE SET NULL,
    expires_at timestamptz, -- For temporary/break-glass access
    created_at timestamptz DEFAULT now(),
    PRIMARY KEY (admin_id, role_id)
);

-- 6. Create Admin Activity Logs (Immutable Audit Trail)
CREATE TABLE IF NOT EXISTS public.admin_activity_logs (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    admin_id uuid REFERENCES public.admins(id) ON DELETE SET NULL,
    action text NOT NULL,
    entity_type text,
    entity_id text,
    ip_address text,
    user_agent text,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz DEFAULT now()
);

-- 7. Create Admin Action Requests (Maker-Checker / Four-Eyes)
CREATE TABLE IF NOT EXISTS public.admin_action_requests (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    requester_id uuid REFERENCES public.admins(id) ON DELETE CASCADE,
    action_type text NOT NULL,
    payload jsonb NOT NULL,
    status text DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
    approver_id uuid REFERENCES public.admins(id) ON DELETE SET NULL,
    approval_metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- 8. Create Admin Sessions (For Session Map & Emergency Lockdown)
CREATE TABLE IF NOT EXISTS public.admin_sessions (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    admin_id uuid REFERENCES public.admins(id) ON DELETE CASCADE,
    ip_address text,
    device_info jsonb,
    current_module text,
    status text DEFAULT 'active', -- 'active', 'locked', 'expired'
    expires_at timestamptz,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_admin_activity_logs_admin_id ON public.admin_activity_logs(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_activity_logs_created_at ON public.admin_activity_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_admin_action_requests_status ON public.admin_action_requests(status);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_admin_id ON public.admin_sessions(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_status ON public.admin_sessions(status);

-- Seed System Permissions
INSERT INTO public.admin_permissions (module, action, description) VALUES
('finance', 'view_treasury', 'View treasury and overall financial stats'),
('finance', 'refund', 'Process a refund'),
('finance', 'approve_withdrawal', 'Approve freelancer withdrawal requests'),
('users', 'view', 'View user profiles'),
('users', 'suspend', 'Suspend a user'),
('kyc', 'view', 'View KYC documents'),
('kyc', 'approve', 'Approve KYC submissions'),
('rbac', 'manage_roles', 'Create, edit, and delete roles'),
('rbac', 'assign_roles', 'Assign roles to admins')
ON CONFLICT DO NOTHING;

-- Seed System Roles
INSERT INTO public.admin_roles (name, description, is_system, risk_level) VALUES
('Super Admin', 'Full platform control', true, 'critical'),
('Finance Admin', 'Manage treasury, escrow, and withdrawals', true, 'critical'),
('Support Admin', 'Manage tickets and user disputes', true, 'medium'),
('Verification Admin', 'Handle KYC and IDV', true, 'low')
ON CONFLICT DO NOTHING;

-- RLS Enforcement
-- For these tables, backend bypasses RLS using service_role key, 
-- so we can lock them down completely from public access.
ALTER TABLE public.admin_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_action_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_sessions ENABLE ROW LEVEL SECURITY;
