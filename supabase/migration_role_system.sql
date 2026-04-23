-- ROLE-BASED BIDDING + TEAM HIRING SYSTEM MIGRATION

BEGIN;

-- 1. Update jobs table
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS job_mode TEXT DEFAULT 'single';

-- 2. Create job_roles table
CREATE TABLE IF NOT EXISTS public.job_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID REFERENCES public.jobs(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    budget DECIMAL(10,2) NOT NULL,
    positions INTEGER DEFAULT 1,
    filled_positions INTEGER DEFAULT 0,
    priority INTEGER DEFAULT 0,
    status TEXT DEFAULT 'open', -- open, partially_filled, filled
    avg_bid DECIMAL(10,2),
    total_bids INTEGER DEFAULT 0,
    best_bid DECIMAL(10,2),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT positions_safety CHECK (filled_positions <= positions)
);

-- 3. Update proposals table
ALTER TABLE public.proposals ADD COLUMN IF NOT EXISTS role_id UUID REFERENCES public.job_roles(id) ON DELETE CASCADE;

-- Add unique constraint to prevent duplicate applications to the same role (Handle existing duplicates first if any)
-- For a production-safe migration, we'd normally clean up first, but here we assume clean state or development.
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'unique_freelancer_role') THEN
        ALTER TABLE public.proposals ADD CONSTRAINT unique_freelancer_role UNIQUE (freelancer_id, role_id);
    END IF;
END $$;

-- 4. Update contracts table
ALTER TABLE public.contracts ADD COLUMN IF NOT EXISTS role_id UUID REFERENCES public.job_roles(id) ON DELETE SET NULL;

-- 5. Optimization Indexes
CREATE INDEX IF NOT EXISTS idx_job_roles_job ON public.job_roles(job_id);
CREATE INDEX IF NOT EXISTS idx_proposals_role ON public.proposals(role_id);
CREATE INDEX IF NOT EXISTS idx_contracts_role ON public.contracts(role_id);

-- 6. Trigger for job_roles updated_at
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_job_roles_updated_at') THEN
        CREATE TRIGGER update_job_roles_updated_at BEFORE UPDATE ON public.job_roles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;

-- 7. Atomic Proposal Acceptance RPC
CREATE OR REPLACE FUNCTION public.handle_proposal_acceptance(
    target_proposal_id UUID,
    target_role_id UUID,
    target_job_id UUID,
    target_freelancer_id UUID,
    target_client_id UUID,
    agreed_rate DECIMAL
) RETURNS JSONB AS $$
DECLARE
    current_filled INTEGER;
    max_positions INTEGER;
    new_contract_id UUID;
    job_closed BOOLEAN := FALSE;
    all_filled BOOLEAN;
BEGIN
    -- 1. Lock the role for update to prevent race conditions
    SELECT filled_positions, positions INTO current_filled, max_positions
    FROM public.job_roles
    WHERE id = target_role_id
    FOR UPDATE;

    IF current_filled >= max_positions THEN
        RAISE EXCEPTION 'Role already filled';
    END IF;

    -- 2. Update Proposal Status
    UPDATE public.proposals
    SET status = 'ACCEPTED', updated_at = NOW()
    WHERE id = target_proposal_id;

    -- 3. Reject other candidates if it was the last position (Optional, but clean)
    -- IF (current_filled + 1) >= max_positions THEN
    --     UPDATE public.proposals
    --     SET status = 'REJECTED'
    --     WHERE role_id = target_role_id AND id != target_proposal_id AND status = 'PENDING';
    -- END IF;

    -- 4. Update Role Positions
    UPDATE public.job_roles
    SET 
        filled_positions = filled_positions + 1,
        status = CASE WHEN (filled_positions + 1) >= positions THEN 'filled' ELSE 'partially_filled' END,
        updated_at = NOW()
    WHERE id = target_role_id;

    -- 5. Create Contract
    INSERT INTO public.contracts (
        proposal_id, job_id, role_id, client_id, freelancer_id, agreed_rate, status, start_date
    ) VALUES (
        target_proposal_id, target_job_id, target_role_id, target_client_id, target_freelancer_id, agreed_rate, 'ACTIVE', NOW()
    ) RETURNING id INTO new_contract_id;

    -- 6. Check if all roles in the job are now filled
    SELECT NOT EXISTS (
        SELECT 1 FROM public.job_roles 
        WHERE job_id = target_job_id AND status != 'filled'
    ) INTO all_filled;

    IF all_filled THEN
        UPDATE public.jobs
        SET status = 'IN_PROGRESS', is_bidding_open = FALSE, updated_at = NOW()
        WHERE id = target_job_id;
        job_closed := TRUE;
    END IF;

    RETURN jsonb_build_object(
        'contract_id', new_contract_id,
        'role_status', CASE WHEN (current_filled + 1) >= max_positions THEN 'filled' ELSE 'partially_filled' END,
        'job_closed', job_closed
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 8. Backfill existing jobs

