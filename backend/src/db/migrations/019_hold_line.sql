-- The hold line - T16, 2026-10-20. docs/AUTO-CALLS.md, "The hold line".
--
-- A "yes" nobody could take waits on hold, rather than hearing the busy line
-- at once, while someone who takes transfers is on a call and so will be free
-- soon: the script's `hold_body`, then the lead's place in line, then music.
--
-- The place is said in the script's own words, as every line of the call is:
--   hold_next_body   "You are next."
--   hold_place_body  "You are number {place} in line."   ({place}: 2, 3, ...)
--
-- `calls.held_at` is when the lead went on hold. A call is waiting while it
-- has one, no result yet, and has not ended - which is also how the robot
-- knows not to place more calls meanwhile (T20). Only an automated call can
-- be on hold.
--
-- The words are set for the one script there is; another script brings its
-- own, or the migration stops rather than leave a script that cannot hold.
ALTER TABLE call_scripts
  ADD COLUMN hold_next_body TEXT,
  ADD COLUMN hold_place_body TEXT;

UPDATE call_scripts
SET hold_next_body = 'You are next.',
    hold_place_body = 'You are number {place} in line.'
WHERE key = 'antibiotics';

ALTER TABLE call_scripts
  ALTER COLUMN hold_next_body SET NOT NULL,
  ALTER COLUMN hold_place_body SET NOT NULL,
  ADD CONSTRAINT call_scripts_hold_place_says_place CHECK (hold_place_body LIKE '%{place}%');

ALTER TABLE calls
  ADD COLUMN held_at TIMESTAMPTZ,
  ADD CONSTRAINT calls_held_is_automated CHECK (held_at IS NULL OR direction = 'automated');

-- The calls waiting now: read on every hold check, and by the robot (T20).
CREATE INDEX calls_on_hold ON calls (held_at)
  WHERE held_at IS NOT NULL AND script_result IS NULL AND outcome IS NULL;
