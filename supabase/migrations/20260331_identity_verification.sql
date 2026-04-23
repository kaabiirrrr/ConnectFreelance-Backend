-- Identity Verification requests
CREATE TABLE IF NOT EXISTS public.identity_verifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','UNDER_REVIEW','APPROVED','REJECTED')),
    document_type TEXT NOT NULL CHECK (document_type IN ('passport','national_id','drivers_license')),
    document_front_url TEXT NOT NULL,
    document_back_url TEXT,
    selfie_url TEXT,
    rejection_reason TEXT,
    reviewed_by UUID REFERENCES public.admins(id),
    reviewed_at TIMESTAMPTZ,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT identity_verifications_user_unique UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_identity_verifications_user_id ON public.identity_verifications(user_id);
CREATE INDEX IF NOT EXISTS idx_identity_verifications_status ON public.identity_verifications(status);

ALTER TABLE public.identity_verifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "User views own verification" ON public.identity_verifications;
CREATE POLICY "User views own verification" ON public.identity_verifications FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "User submits verification" ON public.identity_verifications;
CREATE POLICY "User submits verification" ON public.identity_verifications FOR INSERT
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "User updates own verification" ON public.identity_verifications;
CREATE POLICY "User updates own verification" ON public.identity_verifications FOR UPDATE
    USING (auth.uid() = user_id);
