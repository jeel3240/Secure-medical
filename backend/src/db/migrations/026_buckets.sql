-- Buckets: the campaigns leads arrive in - B07, 2026-11-28. docs/BUCKETS.md,
-- "The database"; docs/SCHEMA.md, `buckets`.
--
-- A bucket is one campaign: the EZ Texting group its leads arrive in, its text
-- questions, its call script, what Seri knows for it. The app runs one today,
-- antibiotics, and is to run several at once (Phase 8). This migration names
-- that one and hangs every flow and call script off it; the columns a bucket
-- needs beyond its name - its groups, its switches, its missed-call text, Seri's
-- pack - each come with the ticket that first reads them (B21, B26, B33-B36).
--
-- Nothing reads `bucket_id` yet. The code still reads "the active flow" and "the
-- active script" and relies on there being one, so `flows_one_active` and
-- `call_scripts_one_active` stay, beside the per-bucket indexes that take their
-- place: B08 drops the first, B18 the second.
--
-- What it changes: a new table with one row; a new column on `flows` and on
-- `call_scripts`, filled in for every row; `conversations.flow_id` made
-- required, the bucket being its flow's. Every conversation has had a flow since
-- 012 (it filled in the older ones, and `startConversation` sets it); it stops,
-- changing nothing, if one has not. No value already in a row changes.

-- 1. buckets --------------------------------------------------------------------

CREATE TABLE buckets (
  id         SERIAL PRIMARY KEY,
  -- Stable name for code: 'antibiotics'. Logs carry the id, `bucketId`: a
  -- `bucketKey` or `name` field is redacted (docs/LOGGING.md, "Redaction").
  key        TEXT NOT NULL,
  -- What the screens show: 'Antibiotics'.
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT buckets_key_unique UNIQUE (key),
  CONSTRAINT buckets_name_unique UNIQUE (name)
);

INSERT INTO buckets (key, name) VALUES ('antibiotics', 'Antibiotics');

-- 2. Every flow belongs to a bucket ---------------------------------------------
--
-- Both flows go to antibiotics: `antibiotics`, the one new leads get, and
-- `wellness`, retired on 2026-10-05, which every conversation from before then
-- is on.

ALTER TABLE flows
  ADD COLUMN bucket_id INTEGER,
  ADD CONSTRAINT flows_bucket_fk FOREIGN KEY (bucket_id) REFERENCES buckets (id);

UPDATE flows SET bucket_id = (SELECT id FROM buckets WHERE key = 'antibiotics');

ALTER TABLE flows ALTER COLUMN bucket_id SET NOT NULL;

-- One active flow per bucket - the flow that bucket's new leads get.
CREATE UNIQUE INDEX flows_one_active_per_bucket ON flows (bucket_id) WHERE is_active;

-- 3. Every call script belongs to a bucket --------------------------------------
--
-- The one script, antibiotics'. A bucket may have none: a new bucket's calls are
-- Seri's (docs/BUCKETS.md).

ALTER TABLE call_scripts
  ADD COLUMN bucket_id INTEGER,
  ADD CONSTRAINT call_scripts_bucket_fk FOREIGN KEY (bucket_id) REFERENCES buckets (id);

UPDATE call_scripts SET bucket_id = (SELECT id FROM buckets WHERE key = 'antibiotics');

ALTER TABLE call_scripts ALTER COLUMN bucket_id SET NOT NULL;

-- At most one active script per bucket - the one its robot calls use.
CREATE UNIQUE INDEX call_scripts_one_active_per_bucket ON call_scripts (bucket_id) WHERE is_active;

-- 4. Every conversation is in a flow --------------------------------------------
--
-- A conversation's bucket is its flow's, so the two can never disagree; one with
-- no flow would have no bucket.

DO $$
DECLARE
  missing integer;
BEGIN
  SELECT count(*) INTO missing FROM conversations WHERE flow_id IS NULL;
  IF missing > 0 THEN
    RAISE EXCEPTION 'conversations: % have no flow_id, so no bucket - each needs its flow before the column can be required', missing;
  END IF;
END $$;

ALTER TABLE conversations ALTER COLUMN flow_id SET NOT NULL;
