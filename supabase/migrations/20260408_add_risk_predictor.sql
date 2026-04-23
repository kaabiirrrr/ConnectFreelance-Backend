-- Add risk assessment fields to profiles
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS risk_analysis JSONB DEFAULT NULL,
ADD COLUMN IF NOT EXISTS risk_last_updated TIMESTAMP WITH TIME ZONE DEFAULT NULL;

-- Index for analytics if needed later
CREATE INDEX IF NOT EXISTS idx_p_risk_last_updated ON public.profiles(risk_last_updated);

COMMENT ON COLUMN public.profiles.risk_analysis IS 'AI-generated project risk summary and client suggestions';
