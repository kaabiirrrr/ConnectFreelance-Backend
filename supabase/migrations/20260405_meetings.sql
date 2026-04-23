CREATE TABLE IF NOT EXISTS meetings (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    host_id         UUID REFERENCES users(id) ON DELETE CASCADE,
    conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
    project_id      TEXT,
    title           TEXT NOT NULL DEFAULT 'Meeting',
    room_id         TEXT NOT NULL UNIQUE,
    room_code       TEXT,                          -- alias for room_id
    participants    UUID[] NOT NULL DEFAULT '{}',  -- array of user UUIDs
    status          TEXT NOT NULL DEFAULT 'scheduled'
                        CHECK (status IN ('scheduled', 'live', 'ended')),
    scheduled_at    TIMESTAMPTZ,
    started_at      TIMESTAMPTZ,
    ended_at        TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_meetings_host       ON meetings(host_id);
CREATE INDEX IF NOT EXISTS idx_meetings_room_id    ON meetings(room_id);
CREATE INDEX IF NOT EXISTS idx_meetings_participants ON meetings USING GIN(participants);

-- Add recording column for Agora cloud recording metadata
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS recording JSONB DEFAULT NULL;
