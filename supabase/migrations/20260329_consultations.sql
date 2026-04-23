-- Consultations: experts offer paid one-on-one sessions
CREATE TABLE IF NOT EXISTS public.consultations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    expert_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    client_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    category TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    duration_minutes INTEGER NOT NULL DEFAULT 30,
    rate DECIMAL(10,2) NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','CONFIRMED','COMPLETED','CANCELLED')),
    scheduled_at TIMESTAMPTZ,
    meeting_link TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_consultations_expert_id ON public.consultations(expert_id);
CREATE INDEX IF NOT EXISTS idx_consultations_client_id ON public.consultations(client_id);

ALTER TABLE public.consultations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Participants view consultations" ON public.consultations;
CREATE POLICY "Participants view consultations" ON public.consultations FOR SELECT
    USING (auth.uid() = expert_id OR auth.uid() = client_id);

DROP POLICY IF EXISTS "Client book consultation" ON public.consultations;
CREATE POLICY "Client book consultation" ON public.consultations FOR INSERT
    WITH CHECK (auth.uid() = client_id);

DROP POLICY IF EXISTS "Participants update consultation" ON public.consultations;
CREATE POLICY "Participants update consultation" ON public.consultations FOR UPDATE
    USING (auth.uid() = expert_id OR auth.uid() = client_id);

-- Billing methods table
CREATE TABLE IF NOT EXISTS public.billing_methods (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    stripe_payment_method_id TEXT NOT NULL,
    stripe_customer_id TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'card',
    brand TEXT,
    last4 TEXT,
    exp_month INTEGER,
    exp_year INTEGER,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_billing_methods_user_id ON public.billing_methods(user_id);

ALTER TABLE public.billing_methods ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "User manages own billing" ON public.billing_methods;
CREATE POLICY "User manages own billing" ON public.billing_methods FOR ALL
    USING (auth.uid() = user_id);
