-- One active flow per bucket, not one in all - B08, 2026-11-28. docs/FLOWS.md,
-- rule 1; docs/BUCKETS.md.
--
-- `flows_one_active` (012) allowed one active flow in the whole table, because
-- the code took "the active flow" for every new lead. Since B08 the code asks
-- for a bucket's active flow (`startConversation`, `db/flows.ts`; Admin >
-- Configuration), and `flows_one_active_per_bucket` (026) keeps that to one per
-- bucket - so each bucket can have its own.
--
-- Only an index goes; no row changes. Safe while the old code still runs
-- between `migrate` and `up` (docs/DEPLOY.md, "Deploying"): it reads "the
-- active flow", and with one bucket there is still one.

DROP INDEX flows_one_active;
