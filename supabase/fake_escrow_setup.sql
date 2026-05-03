-- FAKE ESCROW SYSTEM SETUP (TEST MODE ONLY)

-- 1. Ensure wallets table has required structure
-- The existing table uses available_balance and pending_balance
ALTER TABLE public.wallets ALTER COLUMN available_balance SET DEFAULT 10000;
ALTER TABLE public.wallets ALTER COLUMN pending_balance SET DEFAULT 0;

-- 2. Create fake_escrow_transactions table
CREATE TABLE IF NOT EXISTS public.fake_escrow_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    freelancer_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    contract_id UUID REFERENCES public.contracts(id) ON DELETE CASCADE,
    milestone_id UUID REFERENCES public.milestones(id) ON DELETE CASCADE,
    amount DECIMAL(12,2) NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('FUNDED', 'RELEASED', 'CANCELLED')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. SQL function for atomic fake escrow funding
CREATE OR REPLACE FUNCTION process_fake_escrow_funding(
    p_client_id UUID,
    p_freelancer_id UUID,
    p_contract_id UUID,
    p_milestone_id UUID,
    p_amount DECIMAL
) RETURNS JSONB AS $$
DECLARE
    v_balance DECIMAL;
BEGIN
    -- 1. Lock and Ensure client wallet exists
    INSERT INTO public.wallets (user_id, available_balance)
    VALUES (p_client_id, 10000)
    ON CONFLICT (user_id) DO NOTHING;

    SELECT available_balance INTO v_balance FROM public.wallets WHERE user_id = p_client_id FOR UPDATE;
    
    IF v_balance < p_amount THEN
        RETURN jsonb_build_object('success', false, 'message', 'Insufficient funds in demo wallet');
    END IF;

    -- 2. Deduct from balance, add to pending
    UPDATE public.wallets 
    SET available_balance = available_balance - p_amount,
        pending_balance = pending_balance + p_amount
    WHERE user_id = p_client_id;

    -- 3. Create transaction record in escrow_ledger
    INSERT INTO public.escrow_ledger (
        sender_id, 
        receiver_id, 
        contract_id, 
        milestone_id, 
        amount, 
        type,
        status,
        is_sandbox
    )
    VALUES (
        p_client_id, 
        p_freelancer_id, 
        p_contract_id, 
        p_milestone_id, 
        p_amount, 
        'HOLD',
        'FUNDED',
        true
    );

    -- 4. Update milestone status
    UPDATE public.milestones SET status = 'FUNDED' WHERE id = p_milestone_id;

    RETURN jsonb_build_object('success', true, 'message', 'Demo escrow funded successfully');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. SQL function for atomic fake escrow release
CREATE OR REPLACE FUNCTION process_fake_escrow_release(
    p_transaction_id UUID
) RETURNS JSONB AS $$
DECLARE
    v_client_id UUID;
    v_freelancer_id UUID;
    v_amount DECIMAL;
    v_status TEXT;
    v_milestone_id UUID;
BEGIN
    -- 1. Fetch and lock transaction from escrow_ledger
    SELECT sender_id, receiver_id, amount, status, milestone_id 
    INTO v_client_id, v_freelancer_id, v_amount, v_status, v_milestone_id
    FROM public.escrow_ledger WHERE id = p_transaction_id FOR UPDATE;

    IF v_status != 'FUNDED' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Transaction is not in FUNDED state');
    END IF;

    -- 2. Lock client first then freelancer to avoid deadlocks
    PERFORM * FROM public.wallets WHERE user_id IN (v_client_id, v_freelancer_id) FOR UPDATE;

    -- 3. Move funds: Client Pending -> Freelancer Available
    UPDATE public.wallets SET pending_balance = pending_balance - v_amount WHERE user_id = v_client_id;
    
    INSERT INTO public.wallets (user_id, available_balance) 
    VALUES (v_freelancer_id, v_amount)
    ON CONFLICT (user_id) DO UPDATE 
    SET available_balance = public.wallets.available_balance + v_amount;

    -- 4. Update transaction status in escrow_ledger
    UPDATE public.escrow_ledger 
    SET status = 'RELEASED', 
        type = 'RELEASE',
        created_at = NOW() 
    WHERE id = p_transaction_id;

    -- 5. Update milestone status
    UPDATE public.milestones SET status = 'APPROVED', updated_at = NOW() WHERE id = v_milestone_id;

    RETURN jsonb_build_object('success', true, 'message', 'Demo payment released successfully');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. SQL function for resetting demo balance
CREATE OR REPLACE FUNCTION reset_demo_wallet(p_user_id UUID) 
RETURNS VOID AS $$
BEGIN
    INSERT INTO public.wallets (user_id, available_balance, pending_balance)
    VALUES (p_user_id, 10000, 0)
    ON CONFLICT (user_id) DO UPDATE 
    SET available_balance = 10000, pending_balance = 0;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
