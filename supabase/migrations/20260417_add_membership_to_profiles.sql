-- Migration: Add membership_type to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS membership_type TEXT DEFAULT 'STARTER';

-- Sync existing active memberships (if any)
UPDATE public.profiles p
SET membership_type = m.plan_type
FROM public.memberships m
WHERE p.user_id = m.user_id AND m.status = 'ACTIVE';
