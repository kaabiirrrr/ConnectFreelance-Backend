-- Migration: Create membership_proposals table
-- Purpose: Stores custom/enterprise proposal requests from the Membership page

CREATE TABLE IF NOT EXISTS membership_proposals (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    email TEXT NOT NULL,
    needs TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'REVIEWED', 'RESOLVED', 'REJECTED')),
    admin_comment TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast status filtering
CREATE INDEX IF NOT EXISTS idx_membership_proposals_status ON membership_proposals(status);

-- Index for user lookups
CREATE INDEX IF NOT EXISTS idx_membership_proposals_user ON membership_proposals(user_id);

-- RLS: Enable Row Level Security
ALTER TABLE membership_proposals ENABLE ROW LEVEL SECURITY;

-- Policy: Allow authenticated users to insert their own proposals
CREATE POLICY "Users can insert own proposals"
    ON membership_proposals FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);

-- Policy: Allow service_role full access (backend uses service role key)
CREATE POLICY "Service role full access"
    ON membership_proposals FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
