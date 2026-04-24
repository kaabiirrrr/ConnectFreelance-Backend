-- ============================================================
-- Verifications Table — Full Repair Migration
-- Handles existing partial table + adds all missing columns
-- ============================================================

-- Step 1: Add ALL missing columns safely
ALTER TABLE public.verifications ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'freelancer';
ALTER TABLE public.verifications ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'NOT_SUBMITTED';
ALTER TABLE public.verifications ADD COLUMN IF NOT EXISTS full_name TEXT;
ALTER TABLE public.verifications ADD COLUMN IF NOT EXISTS dob DATE;
ALTER TABLE public.verifications ADD COLUMN IF NOT EXISTS gender TEXT;
ALTER TABLE public.verifications ADD COLUMN IF NOT EXISTS aadhaar_number TEXT;
ALTER TABLE public.verifications ADD COLUMN IF NOT EXISTS pan_number TEXT;
ALTER TABLE public.verifications ADD COLUMN IF NOT EXISTS driving_license_number TEXT;
ALTER TABLE public.verifications ADD COLUMN IF NOT EXISTS document_type TEXT;
ALTER TABLE public.verifications ADD COLUMN IF NOT EXISTS document_urls JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.verifications ADD COLUMN IF NOT EXISTS admin_notes TEXT;
ALTER TABLE public.verifications ADD COLUMN IF NOT EXISTS reviewed_by UUID;
ALTER TABLE public.verifications ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
ALTER TABLE public.verifications ADD COLUMN IF NOT EXISTS last_reminder_sent_at TIMESTAMPTZ;
ALTER TABLE public.verifications ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.verifications ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Step 2: Backfill nulls so constraints don't fail
UPDATE public.verifications SET role = 'freelancer' WHERE role IS NULL;
UPDATE public.verifications SET status = 'NOT_SUBMITTED' WHERE status IS NULL;

-- Step 3: Add NOT NULL after backfill
ALTER TABLE public.verifications ALTER COLUMN role SET NOT NULL;
ALTER TABLE public.verifications ALTER COLUMN status SET NOT NULL;

-- Step 4: Add check constraints only if they don't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'verifications_role_check'
    ) THEN
        ALTER TABLE public.verifications
            ADD CONSTRAINT verifications_role_check
            CHECK (role IN ('client', 'freelancer'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'verifications_status_check'
    ) THEN
        ALTER TABLE public.verifications
            ADD CONSTRAINT verifications_status_check
            CHECK (status IN ('NOT_SUBMITTED', 'PENDING', 'APPROVED', 'REJECTED'));
    END IF;
END $$;

-- Step 5: Indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_verifications_user_role
    ON public.verifications(user_id, role);

CREATE INDEX IF NOT EXISTS idx_verifications_status
    ON public.verifications(status);

CREATE INDEX IF NOT EXISTS idx_verifications_role
    ON public.verifications(role);

-- Step 6: Add verification_status to profiles if missing
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS verification_status TEXT DEFAULT 'NOT_SUBMITTED';

-- Step 7: RLS
ALTER TABLE public.verifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access" ON public.verifications;
CREATE POLICY "Service role full access" ON public.verifications
    FOR ALL USING (true) WITH CHECK (true);
