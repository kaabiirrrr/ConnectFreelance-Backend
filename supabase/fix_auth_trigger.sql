-- ============================================================
-- PASTE THIS ENTIRE SCRIPT INTO THE SUPABASE SQL EDITOR
-- Dashboard -> SQL Editor -> New Query -> Paste -> Run
-- ============================================================

-- STEP 1: Check what triggers exist on auth.users  
-- (You'll see the broken one in the results)
SELECT 
    trigger_name,
    event_manipulation,
    action_statement
FROM information_schema.triggers 
WHERE event_object_schema = 'auth' 
  AND event_object_table = 'users';

-- STEP 2: Check auth hooks
SELECT * FROM auth.hooks LIMIT 10;

-- STEP 3: Drop the most common broken trigger (handle_new_user)
-- This is the default trigger Supabase adds for new projects
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;

-- STEP 4: Verify all auth-related triggers are gone
SELECT trigger_name FROM information_schema.triggers 
WHERE event_object_schema = 'auth';

-- If you see other triggers, drop them too:
-- DROP TRIGGER IF EXISTS <trigger_name> ON auth.users;
