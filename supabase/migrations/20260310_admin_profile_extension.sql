-- Admin Profile Migration
-- Run this in your Supabase SQL Editor at: https://supabase.com/dashboard

ALTER TABLE public.admins 
ADD COLUMN IF NOT EXISTS name TEXT DEFAULT 'Admin',
ADD COLUMN IF NOT EXISTS photo_url TEXT,
ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS phone TEXT,
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Update existing rows with default name from email
UPDATE public.admins SET name = split_part(email, '@', 1) WHERE name IS NULL;

-- Create storage bucket for admin avatars
INSERT INTO storage.buckets (id, name, public)
VALUES ('admin-avatars', 'admin-avatars', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for admin avatars
DO $$
BEGIN
  DROP POLICY IF EXISTS "Admin avatar public read" ON storage.objects;
  CREATE POLICY "Admin avatar public read" ON storage.objects
  FOR SELECT USING (bucket_id = 'admin-avatars');

  DROP POLICY IF EXISTS "Admin can upload avatar" ON storage.objects;
  CREATE POLICY "Admin can upload avatar" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'admin-avatars' AND auth.role() = 'authenticated');

  DROP POLICY IF EXISTS "Admin can update avatar" ON storage.objects;
  CREATE POLICY "Admin can update avatar" ON storage.objects
  FOR UPDATE USING (bucket_id = 'admin-avatars' AND auth.role() = 'authenticated');

  DROP POLICY IF EXISTS "Admin can delete avatar" ON storage.objects;
  CREATE POLICY "Admin can delete avatar" ON storage.objects
  FOR DELETE USING (bucket_id = 'admin-avatars' AND auth.role() = 'authenticated');
END $$;
