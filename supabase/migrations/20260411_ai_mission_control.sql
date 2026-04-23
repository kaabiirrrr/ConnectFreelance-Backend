-- Enterprise AI Mission Control Migration
-- Goal: Enforce mission clarity and isolation.

-- 1. Extend job_members table with scope governance
ALTER TABLE job_members 
ADD COLUMN IF NOT EXISTS scope TEXT,
ADD COLUMN IF NOT EXISTS scope_version INTEGER DEFAULT 1,
ADD COLUMN IF NOT EXISTS scope_updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS scope_acknowledged BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMP WITH TIME ZONE;

-- 2. Create job_member_scope_history for audit trials
CREATE TABLE IF NOT EXISTS job_member_scope_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
    member_id UUID REFERENCES job_members(id) ON DELETE CASCADE,
    scope TEXT NOT NULL,
    actor_id UUID REFERENCES profiles(user_id),
    version INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Extend jobs table with team limits
ALTER TABLE jobs
ADD COLUMN IF NOT EXISTS max_team_size INTEGER DEFAULT 10,
ADD COLUMN IF NOT EXISTS team_locked BOOLEAN DEFAULT false;

-- 4. Enable RLS on the history table
ALTER TABLE job_member_scope_history ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies for history
-- Client can see history for their jobs
CREATE POLICY "Clients can see scope history for their jobs" ON job_member_scope_history
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM jobs 
            WHERE jobs.id = job_member_scope_history.job_id 
            AND jobs.client_id = auth.uid()
        )
    );

-- Freelancer can see their own scope history
CREATE POLICY "Freelancers can see their own scope history" ON job_member_scope_history
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM job_members 
            WHERE job_members.id = job_member_scope_history.member_id 
            AND job_members.user_id = auth.uid()
        )
    );

-- Performance Index
CREATE INDEX IF NOT EXISTS idx_scope_history_member_id ON job_member_scope_history(member_id);
