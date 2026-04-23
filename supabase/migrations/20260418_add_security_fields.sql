-- Migration: Add Security and MFA columns to profiles
DO $$ 
BEGIN
    -- 1. Two-Factor Authentication Status
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='two_factor_enabled') THEN
        ALTER TABLE public.profiles ADD COLUMN two_factor_enabled BOOLEAN DEFAULT FALSE;
    END IF;

    -- 2. Push Notifications Toggle Profile-level
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='push_notifications_enabled') THEN
        ALTER TABLE public.profiles ADD COLUMN push_notifications_enabled BOOLEAN DEFAULT FALSE;
    END IF;

    -- 3. Security Questions
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='security_question') THEN
        ALTER TABLE public.profiles ADD COLUMN security_question TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='security_answer') THEN
        ALTER TABLE public.profiles ADD COLUMN security_answer TEXT;
    END IF;

    -- 4. Audit Log for Security Changes (Optional but recommended)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='security_updated_at') THEN
        ALTER TABLE public.profiles ADD COLUMN security_updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
    END IF;
END $$;
