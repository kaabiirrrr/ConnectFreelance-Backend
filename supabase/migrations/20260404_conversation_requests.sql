-- Add status to conversations for request/accept/reject flow
ALTER TABLE conversations
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'accepted'
    CHECK (status IN ('pending', 'accepted', 'rejected'));

-- Existing conversations are already active, keep them as accepted
UPDATE conversations SET status = 'accepted' WHERE status IS NULL;
