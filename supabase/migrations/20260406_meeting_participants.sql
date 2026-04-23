-- Meeting participants table (tracks who actually joined, with their Agora UID)
CREATE TABLE IF NOT EXISTS meeting_participants (
    meeting_id  UUID REFERENCES meetings(id) ON DELETE CASCADE,
    user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
    agora_uid   INTEGER,
    joined_at   TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (meeting_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_meeting_participants_meeting ON meeting_participants(meeting_id);
CREATE INDEX IF NOT EXISTS idx_meeting_participants_user ON meeting_participants(user_id);

-- Clean up any duplicate participant entries (keep earliest joined_at)
DELETE FROM meeting_participants a
USING meeting_participants b
WHERE a.ctid > b.ctid
  AND a.meeting_id = b.meeting_id
  AND a.user_id = b.user_id;
