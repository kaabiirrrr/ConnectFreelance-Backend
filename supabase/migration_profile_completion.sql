-- Add profile completion tracking columns
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS basic_info_completed BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS professional_info_completed BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS skills_completed BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS portfolio_completed BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS documents_completed BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS profile_completion_percentage INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS step_data JSONB DEFAULT '{}';
