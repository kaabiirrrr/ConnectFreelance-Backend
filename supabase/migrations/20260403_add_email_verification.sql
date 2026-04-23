-- Migration: Add email verification fields to profiles
DO $$ 
BEGIN
    -- Add email_otp column if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='email_otp') THEN
        ALTER TABLE public.profiles ADD COLUMN email_otp TEXT;
    END IF;

    -- Add email_token column if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='email_token') THEN
        ALTER TABLE public.profiles ADD COLUMN email_token TEXT;
    END IF;

    -- Add otp_expires_at column if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='otp_expires_at') THEN
        ALTER TABLE public.profiles ADD COLUMN otp_expires_at TIMESTAMP WITH TIME ZONE;
    END IF;

    -- Add onboarding_step column if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='onboarding_step') THEN
        ALTER TABLE public.profiles ADD COLUMN onboarding_step INTEGER DEFAULT 1;
    END IF;

    -- Add profile_completed column if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='profile_completed') THEN
        ALTER TABLE public.profiles ADD COLUMN profile_completed BOOLEAN DEFAULT FALSE;
    END IF;

    -- Add is_email_verified column if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='is_email_verified') THEN
        ALTER TABLE public.profiles ADD COLUMN is_email_verified BOOLEAN DEFAULT FALSE;
    END IF;

    -- Add email_verified column (for backward compatibility)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='email_verified') THEN
        ALTER TABLE public.profiles ADD COLUMN email_verified BOOLEAN DEFAULT FALSE;
    END IF;

    -- Add category column if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='category') THEN
        ALTER TABLE public.profiles ADD COLUMN category TEXT;
    END IF;

    -- Add rating column if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='rating') THEN
        ALTER TABLE public.profiles ADD COLUMN rating DECIMAL(3,2) DEFAULT 0.00;
    END IF;

    -- Add reviews_count column if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='reviews_count') THEN
        ALTER TABLE public.profiles ADD COLUMN reviews_count INTEGER DEFAULT 0;
    END IF;

    -- Add role column if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='role') THEN
        ALTER TABLE public.profiles ADD COLUMN role TEXT DEFAULT 'FREELANCER';
    END IF;

    -- Add email column if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='email') THEN
        ALTER TABLE public.profiles ADD COLUMN email TEXT;
    END IF;

    -- Add profile_completion_percentage column if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='profile_completion_percentage') THEN
        ALTER TABLE public.profiles ADD COLUMN profile_completion_percentage INTEGER DEFAULT 0;
    END IF;

    -- Add basic_info_completed column if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='basic_info_completed') THEN
        ALTER TABLE public.profiles ADD COLUMN basic_info_completed BOOLEAN DEFAULT FALSE;
    END IF;

    -- Add professional_info_completed column if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='professional_info_completed') THEN
        ALTER TABLE public.profiles ADD COLUMN professional_info_completed BOOLEAN DEFAULT FALSE;
    END IF;

    -- Add skills_completed column if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='skills_completed') THEN
        ALTER TABLE public.profiles ADD COLUMN skills_completed BOOLEAN DEFAULT FALSE;
    END IF;

    -- Add portfolio_completed column if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='portfolio_completed') THEN
        ALTER TABLE public.profiles ADD COLUMN portfolio_completed BOOLEAN DEFAULT FALSE;
    END IF;

    -- Add documents_completed column if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='documents_completed') THEN
        ALTER TABLE public.profiles ADD COLUMN documents_completed BOOLEAN DEFAULT FALSE;
    END IF;

    -- Add step_data column if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='step_data') THEN
        ALTER TABLE public.profiles ADD COLUMN step_data JSONB DEFAULT '{}';
    END IF;

    -- Add location column if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='location') THEN
        ALTER TABLE public.profiles ADD COLUMN location TEXT;
    END IF;

    -- Add country column if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='country') THEN
        ALTER TABLE public.profiles ADD COLUMN country TEXT;
    END IF;

    -- Add city column if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='city') THEN
        ALTER TABLE public.profiles ADD COLUMN city TEXT;
    END IF;

    -- Add phone column if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='phone') THEN
        ALTER TABLE public.profiles ADD COLUMN phone TEXT;
    END IF;

    -- Add website column if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='website') THEN
        ALTER TABLE public.profiles ADD COLUMN website TEXT;
    END IF;

    -- Add dob column if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='dob') THEN
        ALTER TABLE public.profiles ADD COLUMN dob DATE;
    END IF;

    -- Add gender column if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='gender') THEN
        ALTER TABLE public.profiles ADD COLUMN gender TEXT;
    END IF;
END $$;

-- Create reviews table if not exists
CREATE TABLE IF NOT EXISTS public.reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reviewer_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    reviewee_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    contract_id UUID REFERENCES public.contracts(id) ON DELETE SET NULL,
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    comment TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
