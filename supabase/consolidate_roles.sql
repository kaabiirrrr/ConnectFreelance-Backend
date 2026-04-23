-- Migration Script: Consolidate roles into profiles table
-- Renaming user_id to id for consistency with user request
ALTER TABLE public.profiles RENAME COLUMN user_id TO id;

-- Add email and role columns
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS role TEXT;

-- Initial data sync from public.users
INSERT INTO public.profiles (id, email, role, name)
SELECT id, email, role::text, 'User' FROM public.users
ON CONFLICT (id) DO UPDATE SET 
    role = EXCLUDED.role, 
    email = EXCLUDED.email;

-- Initial data sync from public.admins (Overwrites if user exists in both, prioritizing Admin role)
INSERT INTO public.profiles (id, email, role, name)
SELECT id, email, role::text, 'Admin' FROM public.admins
ON CONFLICT (id) DO UPDATE SET 
    role = EXCLUDED.role, 
    email = EXCLUDED.email;

-- Trigger function to keep profiles in sync with users
CREATE OR REPLACE FUNCTION sync_user_to_profile()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, email, role, name)
    VALUES (NEW.id, NEW.email, NEW.role::text, 'User')
    ON CONFLICT (id) DO UPDATE SET
        email = NEW.email,
        role = NEW.role::text;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for public.users
DROP TRIGGER IF EXISTS tr_sync_user_to_profile ON public.users;
CREATE TRIGGER tr_sync_user_to_profile
AFTER INSERT OR UPDATE ON public.users
FOR EACH ROW EXECUTE FUNCTION sync_user_to_profile();

-- Trigger function to keep profiles in sync with admins
CREATE OR REPLACE FUNCTION sync_admin_to_profile()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, email, role, name)
    VALUES (NEW.id, NEW.email, NEW.role::text, 'Admin')
    ON CONFLICT (id) DO UPDATE SET
        email = NEW.email,
        role = NEW.role::text;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for public.admins
DROP TRIGGER IF EXISTS tr_sync_admin_to_profile ON public.admins;
CREATE TRIGGER tr_sync_admin_to_profile
AFTER INSERT OR UPDATE ON public.admins
FOR EACH ROW EXECUTE FUNCTION sync_admin_to_profile();
