-- ==========================================
-- MIGRATION: Fix Identity Verification Schema
-- Run this in your Supabase SQL Editor
-- ==========================================

-- 1. Add user_role column to identity_verifications
ALTER TABLE public.identity_verifications 
ADD COLUMN IF NOT EXISTS user_role TEXT;

-- 2. Backfill user_role from public.users table (via user_id link)
-- This ensures existing requests show up in the correct admin tab
UPDATE public.identity_verifications iv
SET user_role = u.role::text
FROM public.users u
WHERE iv.user_id = u.id
AND iv.user_role IS NULL;

-- 3. FIX RELATIONSHIP FOR ADMIN DASHBOARD (Join error PGRST200)
-- This ensures Supabase can join verifications with profiles
ALTER TABLE public.identity_verifications 
DROP CONSTRAINT IF EXISTS fk_idv_profiles,
ADD CONSTRAINT fk_idv_profiles FOREIGN KEY (user_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;

-- 4. Add index for faster admin filtering
CREATE INDEX IF NOT EXISTS idx_identity_verifications_user_role 
ON public.identity_verifications(user_role);
