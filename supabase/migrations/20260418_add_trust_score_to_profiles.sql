-- Migration: Add Trust Score to Profiles
-- Description: Adds a global reputation metric for each user.

ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS trust_score INTEGER DEFAULT 95;

-- Initialize existing profiles with a healthy base score (95%)
-- We subtract 5 points per existing warning to make it "real"
UPDATE public.profiles 
SET trust_score = GREATEST(0, 95 - (COALESCE(warning_count, 0) * 5));

COMMENT ON COLUMN public.profiles.trust_score IS 'Global reputation metric (0-100)';
