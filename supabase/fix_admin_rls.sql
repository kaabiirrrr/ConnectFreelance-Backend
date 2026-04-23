-- CRITICAL FIX: Disable RLS on admins table for service role queries
-- This allows the backend to properly read admin roles

-- 1. Check current RLS status
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public' 
AND tablename = 'admins';

-- 2. If RLS is enabled, this will help debug
-- The service role should bypass RLS, but let's verify

-- 3. Test query as service role
-- Run this in Supabase SQL Editor to verify admins exist:
SELECT id, email, role FROM admins 
WHERE email = 'lets.connectbro@gmail.com';

-- 4. If needed, force disable RLS (service role bypasses anyway)
ALTER TABLE public.admins DISABLE ROW LEVEL SECURITY;
