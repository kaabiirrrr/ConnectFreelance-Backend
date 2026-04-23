-- Migration: Add missing call_logs and conversations tables
-- These tables are referenced in socket code but were missing from schema

-- ============================================
-- 1. CONVERSATIONS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS public.conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    participant_1 UUID REFERENCES public.users(id) ON DELETE CASCADE,
    participant_2 UUID REFERENCES public.users(id) ON DELETE CASCADE,
    contract_id UUID REFERENCES public.contracts(id) ON DELETE SET NULL,
    last_message TEXT,
    last_message_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(participant_1, participant_2)
);

-- Index for fast conversation lookups
CREATE INDEX IF NOT EXISTS idx_conversations_participants ON conversations(participant_1, participant_2);
CREATE INDEX IF NOT EXISTS idx_conversations_contract ON conversations(contract_id);
CREATE INDEX IF NOT EXISTS idx_conversations_last_message ON conversations(last_message_at DESC);

-- Trigger for updated_at
CREATE TRIGGER update_conversations_updated_at 
    BEFORE UPDATE ON public.conversations 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- 2. CALL_LOGS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS public.call_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    caller_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    receiver_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    call_type TEXT NOT NULL CHECK (call_type IN ('audio', 'video')),
    duration INTEGER DEFAULT 0, -- in seconds
    status TEXT DEFAULT 'completed' CHECK (status IN ('completed', 'missed', 'rejected', 'failed')),
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    ended_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for call history queries
CREATE INDEX IF NOT EXISTS idx_call_logs_caller ON call_logs(caller_id);
CREATE INDEX IF NOT EXISTS idx_call_logs_receiver ON call_logs(receiver_id);
CREATE INDEX IF NOT EXISTS idx_call_logs_created ON call_logs(created_at DESC);

-- ============================================
-- 3. UPDATE MESSAGES TABLE TO REFERENCE CONVERSATIONS
-- ============================================
-- Add conversation_id column if it doesn't exist
ALTER TABLE public.messages 
    ADD COLUMN IF NOT EXISTS conversation_id UUID REFERENCES public.conversations(id) ON DELETE CASCADE;

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_receiver ON messages(receiver_id);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at DESC);

-- ============================================
-- 4. ADD MISSING COLUMNS TO ADMINS TABLE
-- ============================================
ALTER TABLE public.admins
    ADD COLUMN IF NOT EXISTS name TEXT,
    ADD COLUMN IF NOT EXISTS phone TEXT,
    ADD COLUMN IF NOT EXISTS photo_url TEXT,
    ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Create index for admin role lookups
CREATE INDEX IF NOT EXISTS idx_admins_role ON admins(role);

-- Trigger for updated_at on admins
CREATE TRIGGER update_admins_updated_at 
    BEFORE UPDATE ON public.admins 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- 5. ADD PROFILE COMPLETION TRACKING
-- ============================================
-- This migration already exists, but let's ensure it's applied
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS basic_info_completed BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS professional_info_completed BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS skills_completed BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS portfolio_completed BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS documents_completed BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS profile_completion_percentage INTEGER DEFAULT 0;

-- ============================================
-- 6. ADD CONNECTS BALANCE TRACKING
-- ============================================
CREATE TABLE IF NOT EXISTS public.connects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    freelancer_id UUID REFERENCES public.users(id) ON DELETE CASCADE UNIQUE,
    balance INTEGER DEFAULT 0,
    purchased_connects INTEGER DEFAULT 0,
    free_connects INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_connects_freelancer ON connects(freelancer_id);

CREATE TRIGGER update_connects_updated_at 
    BEFORE UPDATE ON public.connects 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Connects transaction history
CREATE TABLE IF NOT EXISTS public.connects_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    freelancer_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    change_amount INTEGER NOT NULL,
    reason TEXT NOT NULL,
    reference_type TEXT, -- 'JOB_PROPOSAL', 'PURCHASE', 'REFUND'
    reference_id UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_connects_history_freelancer ON connects_history(freelancer_id);
CREATE INDEX IF NOT EXISTS idx_connects_history_created ON connects_history(created_at DESC);

COMMENT ON TABLE public.connects IS 'Virtual currency for freelancers to send proposals';
COMMENT ON TABLE public.connects_history IS 'Transaction history for connects';
