-- Direct Contracts: client hires freelancer without a job post/proposal
-- Run in Supabase SQL Editor

ALTER TABLE public.contracts
    ADD COLUMN IF NOT EXISTS is_direct BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS title TEXT,
    ADD COLUMN IF NOT EXISTS description TEXT,
    ADD COLUMN IF NOT EXISTS project_type TEXT CHECK (project_type IN ('HOURLY', 'FIXED')) DEFAULT 'FIXED',
    ADD COLUMN IF NOT EXISTS weekly_limit DECIMAL(10,2);

-- Index for listing direct contracts
CREATE INDEX IF NOT EXISTS idx_contracts_is_direct ON public.contracts (is_direct);
CREATE INDEX IF NOT EXISTS idx_contracts_client_id ON public.contracts (client_id);
CREATE INDEX IF NOT EXISTS idx_contracts_freelancer_id ON public.contracts (freelancer_id);
