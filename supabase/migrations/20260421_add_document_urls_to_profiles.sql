-- Migration: Add document and resume URL columns to profiles
DO $$ 
BEGIN
    -- Add resume_url column if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name='resume_url') THEN
        ALTER TABLE public.profiles ADD COLUMN resume_url TEXT;
    END IF;

    -- Add document_url column if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name='document_url') THEN
        ALTER TABLE public.profiles ADD COLUMN document_url TEXT;
    END IF;

    -- Add step_data column if not exists (insurance)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name='step_data') THEN
        ALTER TABLE public.profiles ADD COLUMN step_data JSONB DEFAULT '{}'::jsonb;
    END IF;
END $$;
