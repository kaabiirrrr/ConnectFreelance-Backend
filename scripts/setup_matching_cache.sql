-- AI SMART MATCHING CACHE TABLE
-- Enterprise-Grade Freelancer Ranking System

CREATE TABLE IF NOT EXISTS public.matching_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    proposal_id UUID NOT NULL REFERENCES public.proposals(id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES public.job_roles(id) ON DELETE CASCADE,
    freelancer_id UUID NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
    
    -- Scoring Metrics (0-100)
    match_score INTEGER DEFAULT 0,
    reliability_score INTEGER DEFAULT 0,
    risk_score INTEGER DEFAULT 0,
    completion_rate INTEGER DEFAULT 0,
    skills_match FLOAT DEFAULT 0,
    price_score INTEGER DEFAULT 0,
    
    -- Insights & Metadata
    confidence_score FLOAT DEFAULT 0,
    ai_summary TEXT,
    ai_verdict TEXT,
    recalc_key TEXT,
    
    -- Lifecycle
    expires_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    
    -- Ensure one cache entry per proposal
    CONSTRAINT unique_proposal_cache UNIQUE (proposal_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_match_role ON public.matching_cache(role_id);
CREATE INDEX IF NOT EXISTS idx_match_score ON public.matching_cache(match_score DESC);

-- Enable RLS
ALTER TABLE public.matching_cache ENABLE ROW LEVEL SECURITY;

-- Allow clients to read matching data for their own jobs
CREATE POLICY "Clients can read match data for their jobs" ON public.matching_cache
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.proposals p
            JOIN public.jobs j ON p.job_id = j.id
            WHERE p.id = matching_cache.proposal_id
            AND j.client_id = auth.uid()
        )
    );
