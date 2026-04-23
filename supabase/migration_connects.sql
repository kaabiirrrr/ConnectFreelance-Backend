-- Migration: Add Connects System

-- 1. Add connects_balance to profiles table (default 0 or maybe 50 for new users, sticking to 0 for now)
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS connects_balance INTEGER DEFAULT 0;

-- 2. Create connects_transactions table for history
CREATE TABLE IF NOT EXISTS public.connects_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    amount INTEGER NOT NULL, -- positive for credits (e.g., +10), negative for debits (e.g., -2)
    type TEXT NOT NULL, -- 'Purchased', 'Applied to job', 'Free', 'Rollover', 'Refunded', 'Membership Downgrade'
    description TEXT, -- Specific details like "Applied for Job: Web Developer"
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Note: A real app would also have triggers or server-logic to ensure 
-- the balance in 'profiles' is always the SUM(amount) in 'connects_transactions'.
-- For now, our backend API will handle updating the balance explicitly alongside creating the transaction record.
