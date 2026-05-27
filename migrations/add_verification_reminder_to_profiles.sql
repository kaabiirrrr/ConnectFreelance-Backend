-- Add last_verification_reminder_at to profiles table
-- Used to track when an admin last sent a verification reminder to users
-- who have no identity_verifications row yet (never submitted docs)
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS last_verification_reminder_at TIMESTAMPTZ;
