-- Migration: Add Notification Preferences JSONB column to profiles
DO $$ 
BEGIN
    -- 1. Add notification_preferences column
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='notification_preferences') THEN
        ALTER TABLE public.profiles ADD COLUMN notification_preferences JSONB DEFAULT '{
            "desktop": { "push": "all", "acoustic": true, "badge": "all" },
            "mobile": { "interface": "all", "badge": "all" },
            "email": { "unread": "all", "frequency": "60", "inactivity_only": false },
            "email_intelligence": { 
                "proposals": true, 
                "interviews": true, 
                "offer": true, 
                "contracts": true, 
                "expirations": true, 
                "talent_flow": true 
            }
        }'::JSONB;
    END IF;

    -- 2. Index for performance (optional but good for JSONB)
    -- CREATE INDEX IF NOT EXISTS idx_profiles_notification_preferences ON public.profiles USING GIN (notification_preferences);
END $$;
