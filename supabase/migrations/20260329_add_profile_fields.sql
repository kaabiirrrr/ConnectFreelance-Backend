-- Migration: Add missing profile fields
DO $$ 
BEGIN
    -- Add phone column if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='phone') THEN
        ALTER TABLE public.profiles ADD COLUMN phone TEXT;
    END IF;

    -- Add website column if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='website') THEN
        ALTER TABLE public.profiles ADD COLUMN website TEXT;
    END IF;

    -- Add dob (date of birth) column if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='dob') THEN
        ALTER TABLE public.profiles ADD COLUMN dob DATE;
    END IF;

    -- Add gender column if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='gender') THEN
        ALTER TABLE public.profiles ADD COLUMN gender TEXT;
    END IF;

    -- Add country column if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='country') THEN
        ALTER TABLE public.profiles ADD COLUMN country TEXT;
    END IF;

    -- Add city column if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='city') THEN
        ALTER TABLE public.profiles ADD COLUMN city TEXT;
    END IF;

    -- Add location column if not exists (for combined display)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='location') THEN
        ALTER TABLE public.profiles ADD COLUMN location TEXT;
    END IF;

    -- Add hourly_rate column if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='hourly_rate') THEN
        ALTER TABLE public.profiles ADD COLUMN hourly_rate NUMERIC;
    END IF;

    -- Add experience column if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='experience') THEN
        ALTER TABLE public.profiles ADD COLUMN experience TEXT;
    END IF;
END $$;
