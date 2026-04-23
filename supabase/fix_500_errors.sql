-- ============================================================
-- Migration: Fix 500 Errors
-- Run this in Supabase SQL Editor
-- ============================================================

-- 1. Add missing columns to profiles if they don't exist
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS country TEXT,
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Backfill user_id from id if they match (profile.id is the auth user id)
UPDATE public.profiles SET user_id = id WHERE user_id IS NULL;

-- 2. Create connects table
CREATE TABLE IF NOT EXISTS public.connects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    freelancer_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    balance INTEGER NOT NULL DEFAULT 0,
    purchased_connects INTEGER NOT NULL DEFAULT 0,
    free_connects INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (freelancer_id)
);

-- 3. Create connects_history table
CREATE TABLE IF NOT EXISTS public.connects_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    freelancer_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    change_amount INTEGER NOT NULL,
    reason TEXT NOT NULL,
    reference_type TEXT,
    reference_id UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. Add FK from jobs.client_id to profiles.user_id
--    This allows: .select('*, client:profiles!jobs_client_id_fkey(...)')
--    First drop old FK if it exists (pointing to users), then add new one to profiles

DO $$
BEGIN
  -- Drop old FK to users if exists
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'jobs_client_id_fkey'
    AND table_name = 'jobs'
  ) THEN
    ALTER TABLE public.jobs DROP CONSTRAINT jobs_client_id_fkey;
  END IF;
END $$;

-- Add FK from jobs.client_id to profiles.user_id
ALTER TABLE public.jobs
  ADD CONSTRAINT jobs_client_id_fkey
  FOREIGN KEY (client_id) REFERENCES public.profiles(user_id) ON DELETE SET NULL;

-- 5. Enable Row Level Security on connects (allow authenticated users to read their own)
ALTER TABLE public.connects ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "freelancers_own_connects" ON public.connects
  FOR ALL USING (auth.uid() = freelancer_id);

-- 6. Create updated_at trigger if update_updated_at_column function exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_connects_updated_at') THEN
      CREATE TRIGGER update_connects_updated_at
        BEFORE UPDATE ON public.connects
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
  END IF;
END $$;
