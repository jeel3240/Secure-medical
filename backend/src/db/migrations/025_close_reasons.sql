-- Why a lead was closed, and the conversation an outcome closed - B04,
-- 2026-11-28. docs/AGENT-WORKSPACE.md, "Dispositions"; docs/BUCKETS.md, "A
-- closed lead joins a new bucket".
--
-- Since 2026-09-28 Closed has stood for sold, not interested and wrong number
-- alike. Jeel, 2026-11-27: pressing Closed asks which, and the answer is kept
-- with the outcome - so a new bucket can tell a sale from a wrong number
-- (B22), and Admin can count sales (B05).
--
-- `reason`: 'sold', 'not_interested' or 'wrong_number', on a Closed only.
-- These are new values in a new column - not the retired values of the same
-- names in `value` (core/dispositions.ts, `RETIRED_DISPOSITIONS`), which stay
-- in the rows that have them. Every row before this one has none: nobody was
-- asked. The route still accepts a Closed with no reason for one release, as a
-- browser on the old page sends none until it reloads (B19 makes it required).
--
-- `conversation_id`: the conversation the outcome was saved against - the
-- lead's newest, as the agent saw it. Filled in here for every existing row
-- with the newest conversation the lead had when the outcome was saved:
-- started at or before it, the newest by when it started, then id - the rule
-- of `newestConversation` (db/lead-state.ts), as it stood then.
--
-- What it does not change: no value already in `dispositions`, and no other
-- table. It stops, changing nothing, if an outcome on a lead that has a
-- conversation is left without one - an outcome older than all of its lead's
-- conversations, which intake never makes.

ALTER TABLE dispositions
  ADD COLUMN reason TEXT,
  ADD COLUMN conversation_id INTEGER,
  ADD CONSTRAINT dispositions_reason_known CHECK (reason IN ('sold', 'not_interested', 'wrong_number')),
  ADD CONSTRAINT dispositions_reason_only_closed CHECK (reason IS NULL OR value = 'closed'),
  ADD CONSTRAINT dispositions_conversation_fk FOREIGN KEY (conversation_id) REFERENCES conversations (id);

UPDATE dispositions d
SET conversation_id = (
  SELECT c.id FROM conversations c
  WHERE c.lead_id = d.lead_id AND c.created_at <= d.created_at
  ORDER BY c.created_at DESC, c.id DESC
  LIMIT 1
);

DO $$
DECLARE
  missing integer;
BEGIN
  SELECT count(*) INTO missing
  FROM dispositions d
  WHERE d.conversation_id IS NULL
    AND EXISTS (SELECT 1 FROM conversations c WHERE c.lead_id = d.lead_id);
  IF missing > 0 THEN
    RAISE EXCEPTION 'dispositions: % outcome(s) on a lead with a conversation found no conversation started at or before them', missing;
  END IF;
END $$;
