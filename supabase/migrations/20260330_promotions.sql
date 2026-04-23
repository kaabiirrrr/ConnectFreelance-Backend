-- Freelancer profile promotions (ads/boosts)
CREATE TABLE IF NOT EXISTS public.promotions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    freelancer_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('availability_badge', 'profile_boost')),
    is_active BOOLEAN NOT NULL DEFAULT FALSE,
    started_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    impressions INTEGER DEFAULT 0,
    clicks INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT promotions_freelancer_type_unique UNIQUE (freelancer_id, type)
);

CREATE INDEX IF NOT EXISTS idx_promotions_freelancer_id ON public.promotions(freelancer_id);

ALTER TABLE public.promotions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Freelancer manages promotions" ON public.promotions;
CREATE POLICY "Freelancer manages promotions" ON public.promotions FOR ALL USING (auth.uid() = freelancer_id);
