-- Add last_reminder_sent_at to identity_verifications table
ALTER TABLE public.identity_verifications
    ADD COLUMN IF NOT EXISTS last_reminder_sent_at TIMESTAMPTZ;
