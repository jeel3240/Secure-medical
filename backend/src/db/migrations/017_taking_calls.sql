-- The "Taking calls" switch - T10, 2026-10-18. docs/AUTO-CALLS.md, "Who is
-- free".
--
-- A transfer from an automated call rings only people who switched this on.
-- The switch decides, not the role: a superadmin who works leads turns it on,
-- one who does not leaves it off and is never rung. Off for everyone to begin
-- with, and off again at every sign-in and sign-out, so nobody is rung who did
-- not choose to be today.
--
-- `taking_calls_at` is when it last changed, either way. Every change is also a
-- `calls.availability_changed` row in the activity log, with on or off and why
-- (AUDIT.md), so this column is never the only record of one.
--
-- `taking_calls_why` is why it is as it is now, set on every write of it: by
-- hand, by signing in or out, or by the server after the person let a
-- transfer ring out (T15c, 2026-10-20). The screen reads it to say "Missed a
-- transfer" - the activity log keeps every change, this only the last. Added
-- to this file before it reached production; empty for a switch never set.
ALTER TABLE users
  ADD COLUMN taking_calls BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN taking_calls_at TIMESTAMPTZ,
  ADD COLUMN taking_calls_why TEXT
    CHECK (taking_calls_why IN ('by_hand', 'sign_in', 'sign_out', 'missed_transfer'));

-- "Not on a call" is part of being free (db/presence.ts, FREE_SQL): no call of
-- theirs without an outcome yet. Asked for every person, every time someone is
-- looked for, so it reads a small index of the calls still going rather than
-- every call ever made.
CREATE INDEX calls_under_way_by_agent ON calls (agent_id) WHERE outcome IS NULL;
