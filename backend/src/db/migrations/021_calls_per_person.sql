-- How many automated calls go out at once for each person free to take a
-- "yes" - T29, 2026-11-02. docs/AUTO-CALLS.md, "Traffic".
--
-- Until now one: never more calls going than people free. On production, on
-- 2026-11-02, about 200 calls put 3 leads through to a person - most calls are
-- not answered, or answered and not a yes - so agents sat waiting. Jeel,
-- 2026-11-02: five calls for each person free. A "yes" while everyone free is
-- already ringing or talking waits on the hold line, and the robot places
-- nothing while it waits (T16, T17).
--
-- Read on every look by the worker (`readCallsPerPerson`); shown read-only on
-- Admin > Configuration > Calls. A value it cannot read - not a whole number
-- from 1 to 10 - is this one, 5.
INSERT INTO settings (key, value) VALUES ('auto_call_calls_per_person', '5')
ON CONFLICT (key) DO NOTHING;
