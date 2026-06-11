-- Migration: Add all missing columns to public.profiles
-- These columns are referenced by the backend but were absent from the base schema.

ALTER TABLE public.profiles
  -- Role & auth extras
  ADD COLUMN IF NOT EXISTS role         TEXT NOT NULL DEFAULT 'FREELANCER',
  ADD COLUMN IF NOT EXISTS email        TEXT,

  -- Location
  ADD COLUMN IF NOT EXISTS location     TEXT,
  ADD COLUMN IF NOT EXISTS country      TEXT,
  ADD COLUMN IF NOT EXISTS city         TEXT,

  -- Personal details
  ADD COLUMN IF NOT EXISTS dob          DATE,
  ADD COLUMN IF NOT EXISTS gender       TEXT,
  ADD COLUMN IF NOT EXISTS phone        TEXT,
  ADD COLUMN IF NOT EXISTS website      TEXT,

  -- Skills & category
  ADD COLUMN IF NOT EXISTS category     TEXT,

  -- Professional
  ADD COLUMN IF NOT EXISTS rating             DECIMAL(3,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS connects_balance   INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS resume_url         TEXT,
  ADD COLUMN IF NOT EXISTS online_for_messages BOOLEAN DEFAULT TRUE,

  -- Company / client fields
  ADD COLUMN IF NOT EXISTS company_size   INTEGER,
  ADD COLUMN IF NOT EXISTS industry       TEXT,

  -- Account health
  ADD COLUMN IF NOT EXISTS is_banned        BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_restricted    BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS warning_count    INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS has_availability_badge BOOLEAN DEFAULT FALSE,

  -- Profile completion
  ADD COLUMN IF NOT EXISTS profile_completed              BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS profile_completion_percentage  INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS basic_info_completed           BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS professional_info_completed    BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS skills_completed               BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS portfolio_completed            BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS documents_completed            BOOLEAN DEFAULT FALSE,

  -- Step wizard data
  ADD COLUMN IF NOT EXISTS step_data    JSONB DEFAULT '{}';
