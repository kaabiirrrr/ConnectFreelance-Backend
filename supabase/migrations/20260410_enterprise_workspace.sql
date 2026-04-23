-- Enterprise Workspace Migration
-- Goal: Transform 1:1 hiring into a multi-freelancer collaboration system.

-- 1. Create job_members table
CREATE TABLE IF NOT EXISTS job_members (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
    user_id UUID REFERENCES profiles(user_id) ON DELETE CASCADE,
    added_by UUID REFERENCES profiles(user_id),
    
    role TEXT NOT NULL,
    role_normalized TEXT NOT NULL,
    is_lead BOOLEAN DEFAULT false,
    member_order INTEGER DEFAULT 0,
    
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'removed')),
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    removed_at TIMESTAMP WITH TIME ZONE
);

-- 2. Audit Trail Table
CREATE TABLE IF NOT EXISTS job_member_activity (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
    member_id UUID REFERENCES job_members(id) ON DELETE CASCADE,
    actor_id UUID REFERENCES profiles(user_id),
    
    action_type TEXT NOT NULL, -- 'added' | 'removed' | 'role_changed' | 'status_changed'
    old_value TEXT,
    new_value TEXT,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Constraints
-- One assignment per user per job
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_job_user ON job_members(job_id, user_id);
-- ONLY ONE LEAD PER JOB
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_lead_per_job ON job_members(job_id) WHERE (is_lead = true);
-- Performance Index
CREATE INDEX IF NOT EXISTS idx_job_members_job_id ON job_members(job_id);

-- 4. Enable RLS
ALTER TABLE job_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_member_activity ENABLE ROW LEVEL SECURITY;

-- 5. Migration Logic: Sync existing contracts
INSERT INTO job_members (job_id, user_id, added_by, role, role_normalized, is_lead, status, joined_at)
SELECT 
    job_id, 
    freelancer_id as user_id, 
    client_id as added_by, 
    'Lead Freelancer' as role, 
    'lead' as role_normalized, 
    true as is_lead, 
    'active' as status,
    created_at as joined_at
FROM contracts
ON CONFLICT (job_id, user_id) DO NOTHING;
