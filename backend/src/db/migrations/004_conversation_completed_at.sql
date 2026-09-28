-- When a conversation was completed: the lead's third answer.
--
-- Admin > Overview counts "Answered all 3" for Today, 7 days or 30 days. With
-- nothing recording when a conversation completed, it could only count leads
-- that *arrived* in the period and have completed since - so a lead who arrived
-- yesterday and answered today counted under yesterday. Jeel, 2026-09-28: every
-- number on that page must mean what it says.
--
-- Set by api/reply-flow.ts the moment the state machine moves a conversation to
-- `completed`, and kept on later saves. NULL for any conversation that has not
-- completed.
ALTER TABLE conversations ADD COLUMN completed_at TIMESTAMPTZ;

-- Existing completed conversations. Nothing recorded the moment, but the
-- thanks message is sent the instant a conversation completes, so its time is
-- the moment to within a second. A conversation whose thanks failed to send
-- falls back to updated_at, the last time it was saved - its completion, unless
-- something touched it afterwards.
UPDATE conversations c
SET completed_at = COALESCE(
  (
    SELECT min(m.created_at)
    FROM messages m
    WHERE m.lead_id = c.lead_id
      AND m.direction = 'outbound'
      AND m.created_at >= c.created_at
      AND m.body = (SELECT value FROM settings WHERE key = 'message_thanks')
  ),
  c.updated_at
)
WHERE c.status = 'completed';
