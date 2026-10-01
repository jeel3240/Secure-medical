-- The word a lead chose is kept with their answer - Jeel, 2026-10-01.
-- docs/STATE-MACHINE.md, "The word is kept with the answer".
--
-- An answer was stored as its number only: `q1 = '1'`. Every screen turned the
-- number into a word by looking up today's choice names. The client now wants
-- to rename the choices and add new ones, and from that day a lead who chose
-- "Supplements" last week would read as whatever choice 1 is called this week.
-- Once the names change there is no way to recover what an old lead was
-- offered, so the word is stored from now on, before any name is touched.
--
-- The number stays: scoring reads it. These are what the screens show.
ALTER TABLE conversations
  ADD COLUMN q1_label TEXT,
  ADD COLUMN q2_label TEXT,
  ADD COLUMN q3_label TEXT;

-- Every answer already given was to the choices as they are named today - no
-- name has ever been changed - so today's names are the true ones for them.
-- `Q1: Both` -> `Both`, the way core/score-breakdown.ts strips it.
UPDATE conversations c SET
  q1_label = (SELECT regexp_replace(r.label, '^Q[123]:\s*', '') FROM scoring_rules r
              WHERE r.question = 1 AND r.choice = c.q1),
  q2_label = (SELECT regexp_replace(r.label, '^Q[123]:\s*', '') FROM scoring_rules r
              WHERE r.question = 2 AND r.choice = c.q2),
  q3_label = (SELECT regexp_replace(r.label, '^Q[123]:\s*', '') FROM scoring_rules r
              WHERE r.question = 3 AND r.choice = c.q3)
WHERE c.q1 IS NOT NULL OR c.q2 IS NOT NULL OR c.q3 IS NOT NULL;
