-- Migration: Fix admin_role ENUM to include all roles
-- This updates the existing ENUM type in the database

-- Create new ENUM type with all roles
CREATE TYPE admin_role_new AS ENUM ('SUPER_ADMIN', 'ADMIN', 'MODERATOR', 'FINANCE_ADMIN', 'SUPPORT_ADMIN');

-- Convert existing column to use text temporarily
ALTER TABLE public.admins 
    ALTER COLUMN role TYPE TEXT USING role::text;

-- Now convert to new ENUM type
ALTER TABLE public.admins 
    ALTER COLUMN role TYPE admin_role_new USING role::admin_role_new;

-- Drop old ENUM type
DROP TYPE IF EXISTS admin_role CASCADE;

-- Rename new ENUM to admin_role
ALTER TYPE admin_role_new RENAME TO admin_role;

-- Add comment for documentation
COMMENT ON TYPE admin_role IS 'Administrative roles with different permission levels';
