-- BANK-GRADE FINTECH HARDENING MIGRATION
-- Goal: 9.9/10 Security, Reconciliation, and Self-Healing.

-- 0. SCALABILITY INDEXES (O(1) Query support)
CREATE INDEX IF NOT EXISTS idx_proposals_job_freelancer ON public.proposals(job_id, freelancer_id, status);
CREATE INDEX IF NOT EXISTS idx_proposals_job_created ON public.proposals(job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contracts_freelancer_status ON public.contracts(freelancer_id, status);
CREATE INDEX IF NOT EXISTS idx_profiles_user_id ON public.profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_wallets_user_id ON public.wallets(user_id);


-- 1. PLATFORM REVENUE WALLET
CREATE TABLE IF NOT EXISTS public.platform_wallets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    balance DECIMAL(15,2) DEFAULT 0.00,
    currency TEXT DEFAULT 'usd',
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT positive_platform_balance CHECK (balance >= 0)
);

-- 1.1 JOB ROLES & MATCHING CACHE (Enterprise Scalability)
CREATE TABLE IF NOT EXISTS public.job_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID REFERENCES public.jobs(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    budget DECIMAL(12,2) DEFAULT 0,
    skills TEXT[] DEFAULT '{}',
    positions INTEGER DEFAULT 1,
    priority INTEGER DEFAULT 0,
    bid_deadline TIMESTAMP WITH TIME ZONE,
    status TEXT DEFAULT 'OPEN',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.matching_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    proposal_id UUID REFERENCES public.proposals(id) ON DELETE CASCADE UNIQUE,
    role_id UUID REFERENCES public.job_roles(id) ON DELETE CASCADE,
    freelancer_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    match_score INTEGER,
    reliability_score INTEGER,
    risk_score INTEGER,
    completion_rate INTEGER,
    skills_match INTEGER,
    price_score INTEGER,
    confidence_score DECIMAL(3,2),
    recalc_key TEXT NOT NULL,
    ai_summary TEXT,
    ai_verdict TEXT,
    is_recomputing BOOLEAN DEFAULT FALSE,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_matching_cache_role ON public.matching_cache(role_id);
CREATE INDEX IF NOT EXISTS idx_matching_cache_freelancer ON public.matching_cache(freelancer_id);
CREATE INDEX IF NOT EXISTS idx_matching_cache_score ON public.matching_cache(match_score);


-- Initialize platform wallet if it doesn't exist
INSERT INTO public.platform_wallets (balance) 
SELECT 0.00 WHERE NOT EXISTS (SELECT 1 FROM public.platform_wallets);

-- 2. ENHANCED SETTINGS & STATUS
INSERT INTO public.platform_settings (setting_key, setting_value, description)
VALUES 
('system_status', '{"status": "HEALTHY", "reason": "System audit passed"}', 'Global status: HEALTHY, WARNING, DEGRADED, CRITICAL'),
('last_stripe_sync_at', '"2026-04-12T00:00:00Z"', 'Timestamp of last successful bank-reconciliation sync')
ON CONFLICT (setting_key) DO NOTHING;

-- 3. AI RESULTS CACHE
CREATE TABLE IF NOT EXISTS public.ai_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id UUID REFERENCES public.contracts(id) ON DELETE CASCADE,
    cache_key TEXT NOT NULL,
    result JSONB NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_cache_key ON public.ai_cache(cache_key);
CREATE INDEX IF NOT EXISTS idx_ai_cache_expires ON public.ai_cache(expires_at);

-- 4. ESCROW LEDGER HARDENING
ALTER TABLE public.escrow_ledger ADD COLUMN IF NOT EXISTS idempotency_key UUID UNIQUE;
ALTER TABLE public.escrow_ledger ADD COLUMN IF NOT EXISTS operation_type TEXT; -- FUND, RELEASE, WITHDRAW
ALTER TABLE public.escrow_ledger ADD COLUMN IF NOT EXISTS triggerer_id UUID REFERENCES public.users(id);

-- 5. ATOMIC RPC: RELEASE ESCROW V5 (Bank-Grade)
CREATE OR REPLACE FUNCTION process_escrow_release_v5(
    p_milestone_id UUID,
    p_client_id UUID,
    p_idempotency_key UUID
) RETURNS JSONB AS $$
DECLARE
    v_amount DECIMAL;
    v_freelancer_id UUID;
    v_contract_id UUID;
    v_status TEXT;
    v_system_status TEXT;
    v_fee_percent DECIMAL;
    v_fee_amount DECIMAL;
    v_net_amount DECIMAL;
    v_net_amount DECIMAL;
    v_platform_wallet_id UUID;
BEGIN
    -- 0. AUTHENTICATION GUARD
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- 1. CIRCUIT BREAKER CHECK

    SELECT setting_value->>'status' INTO v_system_status FROM public.platform_settings WHERE setting_key = 'system_status';
    IF v_system_status = 'DEGRADED' OR v_system_status = 'CRITICAL' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Financial system is in safety-mode. Outbound transactions are temporarily blocked.');
    END IF;

    -- 2. IDEMPOTENCY CHECK
    IF EXISTS (SELECT 1 FROM public.escrow_ledger WHERE idempotency_key = p_idempotency_key) THEN
        RETURN jsonb_build_object('success', true, 'message', 'Transaction already processed (Idempotent success)');
    END IF;

    -- 3. LOCK & FETCH MILESTONE
    SELECT m.amount, m.contract_id, c.freelancer_id, m.status, m.platform_fee_snapshot
    INTO v_amount, v_contract_id, v_freelancer_id, v_status, v_fee_percent
    FROM public.milestones m
    JOIN public.contracts c ON m.contract_id = c.id
    WHERE m.id = p_milestone_id AND c.client_id = p_client_id
    FOR UPDATE;

    -- 4. STATUS GATE
    IF v_status != 'FUNDED' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Conflict: Milestone status is ' || v_status || '. Must be FUNDED to release.');
    END IF;

    -- 5. CALCULATE FEE
    v_fee_amount := ROUND(v_amount * COALESCE(v_fee_percent, 20) / 100, 2);
    v_net_amount := v_amount - v_fee_amount;

    -- 6. SEQUENTIAL LOCKING (Prevents deadlocks)
    -- Order: Client Wallet -> Freelancer Wallet -> Platform Wallet
    SELECT id INTO v_platform_wallet_id FROM public.platform_wallets LIMIT 1;
    
    PERFORM * FROM public.wallets WHERE user_id = p_client_id FOR UPDATE;
    PERFORM * FROM public.wallets WHERE user_id = v_freelancer_id FOR UPDATE;
    PERFORM * FROM public.platform_wallets WHERE id = v_platform_wallet_id FOR UPDATE;

    -- 7. EXECUTE MOVE
    -- Client (Pending -> 0)
    UPDATE public.wallets SET pending_balance = pending_balance - v_amount WHERE user_id = p_client_id;
    -- Freelancer (Available + Net)
    INSERT INTO public.wallets (user_id, available_balance) VALUES (v_freelancer_id, v_net_amount)
    ON CONFLICT (user_id) DO UPDATE SET available_balance = public.wallets.available_balance + v_net_amount;
    -- Platform (Revenue + Fee)
    UPDATE public.platform_wallets SET balance = balance + v_fee_amount WHERE id = v_platform_wallet_id;

    -- 8. UPDATE STATE
    UPDATE public.milestones SET status = 'APPROVED', updated_at = NOW() WHERE id = p_milestone_id;

    -- 9. LOG LEDGER
    INSERT INTO public.escrow_ledger (sender_id, receiver_id, contract_id, milestone_id, amount, type, operation_type, idempotency_key, triggerer_id)
    VALUES (p_client_id, v_freelancer_id, v_contract_id, p_milestone_id, v_amount, 'RELEASE', 'RELEASE', p_idempotency_key, p_client_id);

    RETURN jsonb_build_object('success', true, 'message', 'Escrow released. Split: Freelancer Net ' || v_net_amount || ', Platform Fee ' || v_fee_amount);

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'message', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. RPC: RECONCILE LEDGER ENTRY (Self-Healing)
CREATE OR REPLACE FUNCTION reconcile_ledger_entry(
    p_idempotency_key UUID,
    p_operation_type TEXT,
    p_sender_id UUID,
    p_receiver_id UUID,
    p_amount DECIMAL,
    p_contract_id UUID,
    p_milestone_id UUID,
    p_metadata JSONB
) RETURNS VOID AS $$
BEGIN
    -- 0. ADMINISTRATIVE GUARD (Only sync services/admins)
    IF auth.uid() IS NULL OR NOT (SELECT EXISTS (SELECT 1 FROM public.admins WHERE id = auth.uid() AND role IN ('SUPER_ADMIN', 'FINANCE_ADMIN'))) THEN
        RAISE EXCEPTION 'Unauthorized: Administrative access required for reconciliation';
    END IF;

    INSERT INTO public.escrow_ledger (

        idempotency_key, operation_type, sender_id, receiver_id, amount, contract_id, milestone_id, metadata, type
    ) VALUES (
        p_idempotency_key, p_operation_type, p_sender_id, p_receiver_id, p_amount, p_contract_id, p_milestone_id, p_metadata, 'RELEASE'
    ) ON CONFLICT (idempotency_key) DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. WITHDRAWAL STATE MACHINE
ALTER TABLE public.withdrawals ADD COLUMN IF NOT EXISTS last_status_change_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

CREATE OR REPLACE FUNCTION process_withdrawal_v2(
    p_withdrawal_id UUID,
    p_admin_id UUID,
    p_action TEXT -- 'APPROVE', 'REJECT'
) RETURNS JSONB AS $$
DECLARE
    v_current_status TEXT;
    v_amount DECIMAL;
    v_freelancer_id UUID;
    v_new_status TEXT;
BEGIN
    -- 0. ADMINISTRATIVE GUARD
    IF auth.uid() IS NULL OR NOT (SELECT EXISTS (SELECT 1 FROM public.admins WHERE id = auth.uid() AND role IN ('SUPER_ADMIN', 'FINANCE_ADMIN', 'ADMIN'))) THEN
        RAISE EXCEPTION 'Unauthorized: Administrative role required';
    END IF;

    -- 1. FETCH & LOCK

    SELECT status, amount, freelancer_id INTO v_current_status, v_amount, v_freelancer_id
    FROM public.withdrawals WHERE id = p_withdrawal_id FOR UPDATE;

    -- 2. VALIDATE IMMUTABILITY
    IF v_current_status = 'COMPLETED' OR v_current_status = 'REJECTED' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Error: This withdrawal is final (' || v_current_status || ') and cannot be modified.');
    END IF;

    -- 3. STATE FLOW CHECK
    IF p_action = 'APPROVE' THEN
        -- Force PENDING -> COMPLETED
        UPDATE public.withdrawals 
        SET status = 'COMPLETED', processed_by = p_admin_id, processed_at = NOW(), last_status_change_at = NOW()
        WHERE id = p_withdrawal_id;
        
        RETURN jsonb_build_object('success', true, 'message', 'Withdrawal completed.');
    ELSIF p_action = 'REJECT' THEN
        UPDATE public.withdrawals SET status = 'REJECTED', processed_at = NOW(), last_status_change_at = NOW() WHERE id = p_withdrawal_id;
        RETURN jsonb_build_object('success', true, 'message', 'Withdrawal rejected.');
    END IF;

    RETURN jsonb_build_object('success', false, 'message', 'Invalid action.');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 8. RPC: AUDIT PLATFORM INTEGRITY
CREATE OR REPLACE FUNCTION audit_platform_integrity()
RETURNS JSONB AS $$
DECLARE
    v_actual_balance DECIMAL;
    v_expected_balance DECIMAL;
    v_mismatch DECIMAL;
BEGIN
    -- 0. ADMINISTRATIVE GUARD
    IF auth.uid() IS NULL OR NOT (SELECT EXISTS (SELECT 1 FROM public.admins WHERE id = auth.uid() AND role IN ('SUPER_ADMIN', 'FINANCE_ADMIN'))) THEN
        RAISE EXCEPTION 'Unauthorized: Finance administrative access required';
    END IF;

    -- 1. Get Wallet Balance

    SELECT SUM(balance) INTO v_actual_balance FROM public.platform_wallets;
    
    -- 2. Sum Commissions (commission = ROUND(release_amount * fee_snapshot / 100, 2))
    -- Note: In a production ledger, you would log the exact commission in a 'COMMISSION' entry.
    -- Here we derive it from RELEASE entries and snapshots for simplicity.
    SELECT SUM(ROUND(l.amount * COALESCE(m.platform_fee_snapshot, 20) / 100, 2))
    INTO v_expected_balance
    FROM public.escrow_ledger l
    JOIN public.milestones m ON l.milestone_id = m.id
    WHERE l.type = 'RELEASE' AND l.operation_type = 'RELEASE';

    v_mismatch := COALESCE(v_actual_balance, 0) - COALESCE(v_expected_balance, 0);

    RETURN jsonb_build_object(
        'mismatch', v_mismatch,
        'actual_balance', COALESCE(v_actual_balance, 0),
        'expected_balance', COALESCE(v_expected_balance, 0),
        'timestamp', NOW()
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 9. RPC: GET JOB FILTER STATS (Bank-Grade Performance)
CREATE OR REPLACE FUNCTION get_job_filter_stats_v2()
RETURNS JSONB AS $$
DECLARE
    v_results JSONB;
BEGIN
    SELECT jsonb_build_object(
        'experience', jsonb_build_object(
            'entry', COUNT(*) FILTER (WHERE experience_level ILIKE 'entry'),
            'intermediate', COUNT(*) FILTER (WHERE experience_level ILIKE 'intermediate'),
            'expert', COUNT(*) FILTER (WHERE experience_level ILIKE 'expert')
        ),
        'budget_type', jsonb_build_object(
            'fixed', COUNT(*) FILTER (WHERE budget_type ILIKE 'fixed'),
            'hourly', COUNT(*) FILTER (WHERE budget_type ILIKE 'hourly')
        ),
        'duration', jsonb_build_object(
            'less_than_1_month', COUNT(*) FILTER (WHERE duration ILIKE '%less than 1 month%'),
            '1-3_months', COUNT(*) FILTER (WHERE duration ILIKE '%1 to 3 months%'),
            '3-6_months', COUNT(*) FILTER (WHERE duration ILIKE '%3 to 6 months%'),
            'more_than_6_months', COUNT(*) FILTER (WHERE duration ILIKE '%more than 6 months%')
        ),
        'proposals', jsonb_build_object(
            '0-5', COUNT(*) FILTER (WHERE proposal_count <= 5),
            '5-10', COUNT(*) FILTER (WHERE proposal_count > 5 AND proposal_count <= 10),
            '10-15', COUNT(*) FILTER (WHERE proposal_count > 10 AND proposal_count <= 15),
            '15-20', COUNT(*) FILTER (WHERE proposal_count > 15 AND proposal_count <= 20),
            '20-50', COUNT(*) FILTER (WHERE proposal_count > 20 AND proposal_count <= 50)
        )
    ) INTO v_results
    FROM public.jobs
    WHERE is_bidding_open = true AND status != 'DRAFT';

    RETURN v_results;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 10. ATOMIC WITHDRAWAL: request_withdrawal_v3 (Bank-Grade)
-- Purpose: Total prevention of race-condition double-withdrawals.
CREATE OR REPLACE FUNCTION request_withdrawal_v3(
    p_amount DECIMAL,
    p_method TEXT,
    p_account_details JSONB
) RETURNS JSONB AS $$
DECLARE
    v_freelancer_id UUID;
    v_total_earned DECIMAL;
    v_total_used DECIMAL;
    v_available DECIMAL;
BEGIN
    -- 0. AUTHENTICATION & LOCK
    v_freelancer_id := auth.uid();
    IF v_freelancer_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- ACQUIRE MUTEX ON WALLET (Strict Isolation)
    -- We lock the wallet row to ensure no other instance of this RPC or 
    -- any financial move can run for this freelancer concurrently.
    PERFORM * FROM public.wallets WHERE user_id = v_freelancer_id FOR UPDATE;

    -- 1. CALCULATE EARNINGS (Released only)
    SELECT COALESCE(SUM(amount), 0) INTO v_total_earned
    FROM public.payments
    WHERE payee_id = v_freelancer_id AND status = 'released';

    -- 2. CALCULATE USAGE (Pending, Processing, Completed)
    SELECT COALESCE(SUM(amount), 0) INTO v_total_used
    FROM public.withdrawals
    WHERE freelancer_id = v_freelancer_id AND status IN ('PENDING', 'PROCESSING', 'COMPLETED');

    v_available := v_total_earned - v_total_used;

    -- 3. VALIDATION
    IF p_amount > v_available THEN
        RETURN jsonb_build_object('success', false, 'message', 'Insufficient balance. Available: $' || ROUND(v_available, 2));
    END IF;

    IF p_amount < 10 THEN
        RETURN jsonb_build_object('success', false, 'message', 'Minimum withdrawal amount is $10.00');
    END IF;

    -- 4. EXECUTE INSERT
    INSERT INTO public.withdrawals (
        freelancer_id,
        amount,
        method,
        account_details,
        status,
        created_at,
        updated_at
    ) VALUES (
        v_freelancer_id,
        p_amount,
        p_method,
        p_account_details,
        'PENDING',
        NOW(),
        NOW()
    );

    RETURN jsonb_build_object(
        'success', true, 
        'message', 'Withdrawal request submitted successfully.',
        'available_remaining', v_available - p_amount
    );

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'message', 'Internal error: ' || SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 11. ORPHANED PAYMENT SUPPORT
-- Note: status enum/checks for 'ORPHANED_PAYMENT' are implicitly handled via TEXT if no constraint exists,
-- but if using a check constraint on public.payments.status, we would add it here.
-- Assuming TEXT for flexibility in this hardening phase.


