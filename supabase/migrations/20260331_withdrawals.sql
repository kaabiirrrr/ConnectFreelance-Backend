-- Freelancer withdrawal requests
CREATE TABLE IF NOT EXISTS public.withdrawals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    freelancer_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    amount DECIMAL(10,2) NOT NULL CHECK (amount > 0),
    method TEXT NOT NULL CHECK (method IN ('bank_transfer','paypal','stripe')),
    account_details JSONB NOT NULL, -- { account_number, bank_name, paypal_email, etc }
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PROCESSING','COMPLETED','REJECTED')),
    rejection_reason TEXT,
    processed_by UUID REFERENCES public.admins(id),
    processed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_withdrawals_freelancer_id ON public.withdrawals(freelancer_id);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON public.withdrawals(status);

ALTER TABLE public.withdrawals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Freelancer views own withdrawals" ON public.withdrawals;
CREATE POLICY "Freelancer views own withdrawals" ON public.withdrawals FOR SELECT USING (auth.uid() = freelancer_id);

DROP POLICY IF EXISTS "Freelancer creates withdrawal" ON public.withdrawals;
CREATE POLICY "Freelancer creates withdrawal" ON public.withdrawals FOR INSERT WITH CHECK (auth.uid() = freelancer_id);
