ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS otp_purpose TEXT,
ADD COLUMN IF NOT EXISTS otp_attempts INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.profiles.otp_purpose IS
  'Scopes the current OTP to a specific action: job_post | proposal_submit | password_reset | email_change';

COMMENT ON COLUMN public.profiles.otp_attempts IS
  'Number of failed OTP verification attempts. Resets to 0 when a new OTP is issued.';
