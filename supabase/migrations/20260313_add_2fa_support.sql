-- Migration: Add 2FA support for admin accounts
ALTER TABLE public.admins
    ADD COLUMN IF NOT EXISTS two_factor_secret TEXT,
    ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN DEFAULT FALSE;

-- Add index for faster lookups during login
CREATE INDEX IF NOT EXISTS idx_admins_2fa ON admins(two_factor_enabled);

COMMENT ON COLUMN public.admins.two_factor_secret IS 'Base32 encoded secret for TOTP';
COMMENT ON COLUMN public.admins.two_factor_enabled IS 'Whether 2FA is active on this account';
