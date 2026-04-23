const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const https = require('https');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Extract project ref from URL: https://<ref>.supabase.co
const projectRef = SUPABASE_URL.replace('https://', '').split('.')[0];

const sql = `
ALTER TABLE public.admins 
ADD COLUMN IF NOT EXISTS name TEXT,
ADD COLUMN IF NOT EXISTS photo_url TEXT,
ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS phone TEXT,
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
`;

// Use Supabase's REST SQL endpoint
const options = {
    hostname: `${projectRef}.supabase.co`,
    path: '/rest/v1/rpc/exec',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`
    }
};

// Supabase doesn't expose DDL via REST directly. We use the supabase client trick:
// We'll create a server-side function or use the management API.
// However the simplest approach for development: use node-postgres or the pg library.
// Since we likely have @supabase/supabase-js, let's use the .rpc approach with a wrapper.

// Check if there's a pg dependency:
const { execSync } = require('child_process');
try {
    require.resolve('pg');
    console.log('pg available');
} catch {
    console.log('pg not available, trying alternative...');
}

// Use axios to call the Supabase REST v1 SQL endpoint (available in self-hosted or via pg connection string)
// Alternative: just output migration SQL to a .sql file for manual run
const fs = require('fs');
const path = require('path');

const migrationContent = `-- Admin Profile Migration
-- Run this in your Supabase SQL Editor at: https://supabase.com/dashboard

ALTER TABLE public.admins 
ADD COLUMN IF NOT EXISTS name TEXT DEFAULT 'Admin',
ADD COLUMN IF NOT EXISTS photo_url TEXT,
ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS phone TEXT,
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Update existing rows with default name from email
UPDATE public.admins SET name = split_part(email, '@', 1) WHERE name IS NULL;

-- Create storage bucket for profiles if not exists
INSERT INTO storage.buckets (id, name, public)
VALUES ('profilephotos', 'profilephotos', true)
ON CONFLICT (id) DO NOTHING;

-- Allow admins to manage their own avatars
CREATE POLICY IF NOT EXISTS "Admin can upload avatar" ON storage.objects
FOR INSERT WITH CHECK (bucket_id = 'admin-avatars');

CREATE POLICY IF NOT EXISTS "Admin avatar public" ON storage.objects
FOR SELECT USING (bucket_id = 'admin-avatars');
`;

const migrationPath = path.join(__dirname, '../supabase/migrations/20260310_admin_profile_extension.sql');
fs.writeFileSync(migrationPath, migrationContent);
console.log('✅ Migration file created at:', migrationPath);
console.log('\n📋 Please run this SQL in your Supabase dashboard SQL Editor:');
console.log(migrationContent);
