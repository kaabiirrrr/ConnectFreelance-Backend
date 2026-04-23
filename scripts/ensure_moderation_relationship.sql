-- Ensure the violations table explicitly references profiles(user_id) for PostgREST joins
DO $$ 
BEGIN 
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'violations_user_id_fkey'
    ) THEN
        ALTER TABLE violations 
        DROP CONSTRAINT IF EXISTS violations_user_id_fkey,
        ADD CONSTRAINT violations_user_id_fkey 
        FOREIGN KEY (user_id) REFERENCES profiles(user_id) ON DELETE CASCADE;
    END IF;
END $$;

-- Refresh the schema cache
NOTIFY pgrst, 'reload schema';
