-- ── MASTER CONNECT ECONOMY MIGRATION ──────────────────────────────
-- Aligning with Master Spec: Production-Ready, Atomic, and Dynamic

-- 1. MEMBERSHIP PLANS & FEATURES
CREATE TABLE IF NOT EXISTS public.membership_plans (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    price INTEGER NOT NULL, -- In smallest currency unit (e.g. Paise for INR)
    billing_type TEXT DEFAULT 'monthly', -- monthly/yearly
    connects_per_month INTEGER DEFAULT 0,
    service_fee INTEGER DEFAULT 10, -- Percentage
    is_active BOOLEAN DEFAULT true,
    is_popular BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Ensure profiles table has membership columns
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS membership_type TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_pro BOOLEAN DEFAULT false;

CREATE TABLE IF NOT EXISTS public.membership_features (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    plan_id UUID REFERENCES public.membership_plans(id) ON DELETE CASCADE,
    feature TEXT NOT NULL,
    is_highlight BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. USER MEMBERSHIPS (With Snapshotting)
CREATE TABLE IF NOT EXISTS public.memberships (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    plan_id UUID REFERENCES public.membership_plans(id),
    status TEXT DEFAULT 'ACTIVE', -- ACTIVE, EXPIRED, CANCELLED
    start_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    end_date TIMESTAMP WITH TIME ZONE,
    payment_id TEXT, -- Razorpay Payment ID
    order_id TEXT UNIQUE, -- Razorpay Order ID (Idempotency Key)
    plan_snapshot JSONB DEFAULT '{}', -- Snapshot of plan details at time of purchase
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. USER CONNECTS (Wallet)
CREATE TABLE IF NOT EXISTS public.user_connects (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    balance INTEGER DEFAULT 0,
    last_topup_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Handle legacy 'connects' column if it exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_connects' AND column_name='connects') THEN
    ALTER TABLE public.user_connects RENAME COLUMN connects TO balance;
  END IF;
END $$;

-- Ensure required columns exist
ALTER TABLE public.user_connects ADD COLUMN IF NOT EXISTS balance INTEGER DEFAULT 0;
ALTER TABLE public.user_connects ADD COLUMN IF NOT EXISTS last_topup_date TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- 4. CONNECT TRANSACTIONS (Audit Ledger)
CREATE TABLE IF NOT EXISTS public.connect_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    amount INTEGER NOT NULL, -- Positive for Credit, Negative for Debit
    type TEXT NOT NULL CHECK (type IN ('CREDIT', 'DEBIT')),
    action_source TEXT NOT NULL, -- job_post, proposal_submit, membership_payment, etc.
    reference_id TEXT, -- For idempotency (Order ID)
    metadata JSONB DEFAULT '{}',
    status TEXT DEFAULT 'COMPLETED',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Ensure columns exist if table was created by an older migration
ALTER TABLE public.connect_transactions ADD COLUMN IF NOT EXISTS reference_id TEXT;
ALTER TABLE public.connect_transactions ADD COLUMN IF NOT EXISTS action_source TEXT;
ALTER TABLE public.connect_transactions ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';
ALTER TABLE public.connect_transactions ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'COMPLETED';

CREATE UNIQUE INDEX IF NOT EXISTS idx_connect_reference_v2 
ON public.connect_transactions(reference_id) 
WHERE reference_id IS NOT NULL;

-- 5. CONNECT SETTINGS (Admin Control)
CREATE TABLE IF NOT EXISTS public.connect_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    is_connect_system_enabled BOOLEAN DEFAULT false,
    job_post_cost INTEGER DEFAULT 10,
    proposal_cost INTEGER DEFAULT 2,
    proposal_accept_cost INTEGER DEFAULT 5,
    monthly_free_connects INTEGER DEFAULT 20,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Ensure columns exist if table was created by an older migration
ALTER TABLE public.connect_settings ADD COLUMN IF NOT EXISTS is_connect_system_enabled BOOLEAN DEFAULT false;
ALTER TABLE public.connect_settings ADD COLUMN IF NOT EXISTS job_post_cost INTEGER DEFAULT 10;
ALTER TABLE public.connect_settings ADD COLUMN IF NOT EXISTS proposal_cost INTEGER DEFAULT 2;
ALTER TABLE public.connect_settings ADD COLUMN IF NOT EXISTS proposal_accept_cost INTEGER DEFAULT 5;
ALTER TABLE public.connect_settings ADD COLUMN IF NOT EXISTS monthly_free_connects INTEGER DEFAULT 20;

-- ── ATOMIC DATABASE FUNCTIONS ─────────────────────────────────────

-- credit_connects_atomic
CREATE OR REPLACE FUNCTION credit_connects_atomic(
  p_user_id UUID,
  p_amount INT,
  p_action_source TEXT,
  p_reference_id TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'
) 
RETURNS INT
SECURITY DEFINER
AS $$
DECLARE
  current_balance INT;
  new_balance INT;
BEGIN
  -- 1. Idempotency Check
  IF p_reference_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM connect_transactions WHERE reference_id = p_reference_id AND status = 'COMPLETED') THEN
      SELECT balance INTO current_balance FROM user_connects WHERE user_id = p_user_id;
      RETURN COALESCE(current_balance, 0);
    END IF;
  END IF;

  -- 2. Lock or Create Wallet
  INSERT INTO user_connects (user_id, balance, updated_at)
  VALUES (p_user_id, 0, NOW())
  ON CONFLICT (user_id) DO NOTHING;

  SELECT balance INTO current_balance 
  FROM user_connects 
  WHERE user_id = p_user_id 
  FOR UPDATE;

  -- 3. Update Balance
  new_balance := COALESCE(current_balance, 0) + p_amount;
  UPDATE user_connects 
  SET balance = new_balance, updated_at = NOW()
  WHERE user_id = p_user_id;

  -- 4. Log Transaction
  INSERT INTO connect_transactions (
    user_id, type, amount, action_source, reference_id, metadata, status, created_at
  ) VALUES (
    p_user_id, 'CREDIT', p_amount, p_action_source, p_reference_id, p_metadata, 'COMPLETED', NOW()
  );

  RETURN new_balance;
END;
$$ LANGUAGE plpgsql;

-- debit_connects_atomic
CREATE OR REPLACE FUNCTION debit_connects_atomic(
  p_user_id UUID,
  p_amount INT,
  p_action_source TEXT,
  p_metadata JSONB DEFAULT '{}'
) 
RETURNS INT
SECURITY DEFINER
AS $$
DECLARE
  current_balance INT;
  new_balance INT;
BEGIN
  -- 1. Lock Wallet
  SELECT balance INTO current_balance 
  FROM user_connects 
  WHERE user_id = p_user_id 
  FOR UPDATE;

  IF current_balance IS NULL THEN
    RAISE EXCEPTION 'WALLET_NOT_FOUND';
  END IF;

  -- 2. Insufficient Funds Check
  IF current_balance < p_amount THEN
    RAISE EXCEPTION 'INSUFFICIENT_CONNECTS';
  END IF;

  -- 3. Deduct
  new_balance := current_balance - p_amount;
  UPDATE user_connects 
  SET balance = new_balance, updated_at = NOW()
  WHERE user_id = p_user_id;

  -- 4. Log Transaction
  INSERT INTO connect_transactions (
    user_id, type, amount, action_source, metadata, status, created_at
  ) VALUES (
    p_user_id, 'DEBIT', -p_amount, p_action_source, p_metadata, 'COMPLETED', NOW()
  );

  RETURN new_balance;
END;
$$ LANGUAGE plpgsql;

-- ── SEED INITIAL DATA ─────────────────────────────────────────────

-- Initial Settings
INSERT INTO public.connect_settings (is_connect_system_enabled, job_post_cost, proposal_cost, proposal_accept_cost, monthly_free_connects)
VALUES (false, 10, 2, 5, 20)
ON CONFLICT DO NOTHING;

-- Initial Plans
DO $$
DECLARE
  free_id UUID;
  pro_id UUID;
  elite_id UUID;
BEGIN
  -- FREE
  INSERT INTO public.membership_plans (name, price, connects_per_month, service_fee, is_popular)
  VALUES ('FREE', 0, 20, 15, false)
  RETURNING id INTO free_id;

  INSERT INTO public.membership_features (plan_id, feature) VALUES
  (free_id, '20 Connects per month'),
  (free_id, 'Standard Profile Visibility'),
  (free_id, '15% Service Fee');

  -- PRO
  INSERT INTO public.membership_plans (name, price, connects_per_month, service_fee, is_popular)
  VALUES ('PRO', 149900, 100, 5, true)
  RETURNING id INTO pro_id;

  INSERT INTO public.membership_features (plan_id, feature, is_highlight) VALUES
  (pro_id, '100 Connects per month', true),
  (pro_id, 'Verified Pro Badge', true),
  (pro_id, '5% Service Fee', true),
  (pro_id, '2x Search Visibility', false),
  (pro_id, 'AI Proposal Generator', false),
  (pro_id, 'Priority Support', false);

  -- ELITE
  INSERT INTO public.membership_plans (name, price, connects_per_month, service_fee, is_active)
  VALUES ('ELITE', 499900, 300, 2, true)
  RETURNING id INTO elite_id;

  INSERT INTO public.membership_features (plan_id, feature, is_highlight) VALUES
  (elite_id, '300 Connects per month', true),
  (elite_id, 'Elite Partner Status', true),
  (elite_id, '2% Service Fee', true),
  (elite_id, 'Priority Job Placement', false),
  (elite_id, 'Dedicated Account Manager', false);
END $$;
