-- ============================================================
-- AI Recommendation Engine — Database Migration
-- Creates: job_recommendations, recommendation_events
-- Alters:  profiles (preferred_categories, budget range)
-- ============================================================

-- 1. Pre-computed match scores per (freelancer, job) pair
CREATE TABLE IF NOT EXISTS job_recommendations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    freelancer_id UUID NOT NULL,
    job_id UUID NOT NULL,

    -- Core Scores (0–100)
    match_score INTEGER NOT NULL DEFAULT 0,
    skills_score INTEGER NOT NULL DEFAULT 0,
    experience_score INTEGER NOT NULL DEFAULT 0,
    budget_score INTEGER NOT NULL DEFAULT 0,
    trust_score INTEGER NOT NULL DEFAULT 0,
    category_score INTEGER NOT NULL DEFAULT 0,
    client_quality_score INTEGER NOT NULL DEFAULT 0,

    -- Metadata
    confidence DECIMAL(3,2) DEFAULT 0.50,
    match_reason TEXT,
    skills_matched TEXT[] DEFAULT '{}',
    skills_missing TEXT[] DEFAULT '{}',

    -- Lifecycle
    computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '6 hours'),
    is_stale BOOLEAN DEFAULT FALSE,

    UNIQUE(freelancer_id, job_id)
);

CREATE INDEX IF NOT EXISTS idx_job_recs_freelancer
    ON job_recommendations(freelancer_id);

CREATE INDEX IF NOT EXISTS idx_job_recs_score
    ON job_recommendations(freelancer_id, match_score DESC);

CREATE INDEX IF NOT EXISTS idx_job_recs_expires
    ON job_recommendations(expires_at);

CREATE INDEX IF NOT EXISTS idx_job_recs_job
    ON job_recommendations(job_id);

-- 2. Behavioral event tracking (click, save, apply, negative signals)
CREATE TABLE IF NOT EXISTS recommendation_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    freelancer_id UUID NOT NULL,
    job_id UUID NOT NULL,
    job_category TEXT,

    event_type TEXT NOT NULL CHECK (event_type IN (
        'impression',
        'click',
        'save',
        'apply',
        'dismiss',
        'hide_job',
        'not_relevant',
        'dont_show_similar',
        'hired'
    )),

    -- Source tab for A/B analytics
    source_tab TEXT DEFAULT 'best_matches',

    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rec_events_freelancer
    ON recommendation_events(freelancer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_rec_events_type
    ON recommendation_events(freelancer_id, event_type);

CREATE INDEX IF NOT EXISTS idx_rec_events_job
    ON recommendation_events(job_id);

-- 3. Extend profiles for better personalization
ALTER TABLE profiles
    ADD COLUMN IF NOT EXISTS preferred_categories TEXT[] DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS preferred_budget_min DECIMAL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS preferred_budget_max DECIMAL DEFAULT 999999;
