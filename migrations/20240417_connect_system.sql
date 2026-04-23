-- Migration: Initialize Connect Economy System
-- Tables: user_connects, connect_transactions, connect_settings

-- 1. User Connect Wallet
CREATE TABLE IF NOT EXISTS public.user_connects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  connects INTEGER DEFAULT 0,
  last_reset_date TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Connect Transactions (Audit System)
CREATE TABLE IF NOT EXISTS public.connect_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  type TEXT CHECK (type IN ('CREDIT', 'DEBIT')),
  amount INTEGER NOT NULL,
  action TEXT NOT NULL, -- job_post, proposal_submit, proposal_accept, membership, monthly_free
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Admin Control Settings
CREATE TABLE IF NOT EXISTS public.connect_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_post_cost INTEGER DEFAULT 0,
  proposal_submit_cost INTEGER DEFAULT 2,
  proposal_accept_cost INTEGER DEFAULT 0,
  profile_boost_cost INTEGER DEFAULT 5,
  urgent_job_cost INTEGER DEFAULT 10,
  monthly_free_connects INTEGER DEFAULT 20,
  is_connect_system_enabled BOOLEAN DEFAULT false,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed Initial Settings if not exist
INSERT INTO public.connect_settings (
  job_post_cost, 
  proposal_submit_cost, 
  proposal_accept_cost, 
  profile_boost_cost, 
  urgent_job_cost, 
  monthly_free_connects, 
  is_connect_system_enabled
) 
SELECT 0, 2, 0, 5, 10, 20, false
WHERE NOT EXISTS (SELECT 1 FROM public.connect_settings LIMIT 1);

-- Data Migration Trigger (Optional but helpful for existing profiles)
-- This ensures every profile has a record in user_connects
INSERT INTO public.user_connects (user_id, connects)
SELECT user_id, 20 FROM public.profiles
ON CONFLICT (user_id) DO NOTHING;

-- Indexing for performance
CREATE INDEX IF NOT EXISTS idx_connect_transactions_user_id ON public.connect_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_connect_transactions_created_at ON public.connect_transactions(created_at);
