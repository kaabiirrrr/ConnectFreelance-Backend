-- Migration: Create Wallet Ledger for Real-Money Top-ups
-- Purpose: Tracks all deposits, withdrawals, and escrow releases

-- 1. Ensure wallets table is correctly structured
CREATE TABLE IF NOT EXISTS public.wallets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE UNIQUE,
    available_balance DECIMAL(12,2) DEFAULT 0,
    pending_balance DECIMAL(12,2) DEFAULT 0,
    total_earned DECIMAL(12,2) DEFAULT 0,
    total_withdrawn DECIMAL(12,2) DEFAULT 0,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Create wallet_transactions table
CREATE TABLE IF NOT EXISTS public.wallet_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    amount DECIMAL(12,2) NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('deposit', 'withdrawal', 'release')),
    status TEXT DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'failed')),
    description TEXT,
    payment_id TEXT, -- Razorpay Payment ID
    reference_id TEXT, -- Razorpay Order ID or Contract ID
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Enable RLS and Policies
ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own wallet transactions" ON public.wallet_transactions;
CREATE POLICY "Users can view their own wallet transactions"
    ON public.wallet_transactions FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

-- 4. Initial seed for existing users (Optional - will be auto-created on first visit anyway)
-- But making sure balance doesn't reset to 10k by default for new real users
ALTER TABLE public.wallets ALTER COLUMN available_balance SET DEFAULT 0;
ALTER TABLE public.wallets ALTER COLUMN pending_balance SET DEFAULT 0;
