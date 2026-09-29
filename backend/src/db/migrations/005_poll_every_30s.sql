-- Check EZ Texting for new leads every 30 seconds instead of 60 - Jeel,
-- 2026-09-29.
--
-- Testing with a real lead showed the wait: EZ Texting lists a new contact up
-- to a minute or more after it is created, and at 60s the next check could
-- then be almost another minute away - 108 seconds from adding the contact to
-- question 1 going out. 30s is the fast end of the 30-60s CLAUDE.md §6 allows,
-- and still only two list calls a minute at 50-100 leads a day.
--
-- Only the seeded 60 is changed: a value someone set on purpose is kept. The
-- worker re-reads the setting every tick, so no restart is needed.
UPDATE settings
SET value = '30', updated_at = now()
WHERE key = 'poll_interval_seconds' AND value = '60';
