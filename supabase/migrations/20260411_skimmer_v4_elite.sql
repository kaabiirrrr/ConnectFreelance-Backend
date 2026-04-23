-- SKIMMER CO-PILOT ELITE SCHEMA (V4)
-- Migration: 20260411_skimmer_v4_elite.sql

-- 1. Create Priority Enum
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'skimmer_priority') THEN
        CREATE TYPE skimmer_priority AS ENUM ('LOW', 'MEDIUM', 'HIGH');
    END IF;
END $$;

-- 2. Project Insights Table
CREATE TABLE IF NOT EXISTS project_insights (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
    health_score INTEGER DEFAULT 100,
    success_probability FLOAT DEFAULT 1.0,
    delay_risk FLOAT DEFAULT 0.0,
    team_efficiency FLOAT DEFAULT 1.0,
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(job_id)
);

-- 3. Project Tasks (AI Generated)
CREATE TABLE IF NOT EXISTS project_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
    role TEXT,
    title TEXT NOT NULL,
    description TEXT,
    expected_days INTEGER DEFAULT 1,
    status TEXT DEFAULT 'pending', -- pending, in_progress, completed
    assigned_to UUID REFERENCES profiles(user_id) ON DELETE SET NULL,
    version INTEGER DEFAULT 1,
    is_active BOOLEAN DEFAULT true,
    weight INTEGER DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. Project Activity Log (Alerts & Milestones)
CREATE TABLE IF NOT EXISTS project_activity_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
    user_id UUID REFERENCES profiles(user_id) ON DELETE SET NULL,
    type TEXT, -- log, warning, delay, milestone
    priority skimmer_priority DEFAULT 'LOW',
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. Project Health History (Trend Analytics)
CREATE TABLE IF NOT EXISTS project_health_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
    health_score INTEGER NOT NULL,
    change_value INTEGER DEFAULT 0, -- 24h delta
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 6. Add is_blocked to messages (Contact Protection Refinement)
ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN DEFAULT false;

-- Indexes for Performance
CREATE INDEX IF NOT EXISTS idx_project_insights_job_id ON project_insights(job_id);
CREATE INDEX IF NOT EXISTS idx_project_tasks_job_id ON project_tasks(job_id);
CREATE INDEX IF NOT EXISTS idx_project_tasks_status ON project_tasks(status);
CREATE INDEX IF NOT EXISTS idx_project_activity_log_job_id ON project_activity_log(job_id);
CREATE INDEX IF NOT EXISTS idx_project_health_history_job_id ON project_health_history(job_id);
CREATE INDEX IF NOT EXISTS idx_project_health_history_created_at ON project_health_history(created_at);
