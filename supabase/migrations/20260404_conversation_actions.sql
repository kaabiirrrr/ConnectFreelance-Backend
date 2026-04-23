-- Muted conversations (per-user toggle)
CREATE TABLE IF NOT EXISTS muted_conversations (
    conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
    user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (conversation_id, user_id)
);

-- Blocked users
CREATE TABLE IF NOT EXISTS blocked_users (
    blocker_id  UUID REFERENCES users(id) ON DELETE CASCADE,
    blocked_id  UUID REFERENCES users(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (blocker_id, blocked_id)
);

-- User reports
CREATE TABLE IF NOT EXISTS user_reports (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reporter_id UUID REFERENCES users(id) ON DELETE SET NULL,
    reported_id UUID REFERENCES users(id) ON DELETE SET NULL,
    reason      TEXT NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);
