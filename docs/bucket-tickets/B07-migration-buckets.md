# B07 · Migration: buckets

**Goal:** the database knows buckets. Antibiotics becomes the first one, and every flow
and call script belongs to a bucket - with nothing changing for anyone.

**Why:** `BUCKETS.md`, "The database". Every later ticket hangs off a bucket id.

**Depends on:** B03 · **Size:** S · **Status:** To do · **Deploy note:** additive; the
old code ignores the new table and columns.

## Build

A migration (the next free number), in the house style - header, numbered sections, a
comment on each column, named constraints:

1. `buckets`: `id SERIAL PRIMARY KEY`, `key TEXT NOT NULL UNIQUE` (`antibiotics`),
   `name TEXT NOT NULL UNIQUE` (`Antibiotics`), `created_at`. Only these columns now:
   each later ticket adds the column it needs (groups B21, texts switch B26, robot
   switch B34, missed-call text B33, Seri's switch B35, knowledge key B36) - expand
   when needed. One row, `antibiotics`.
2. `flows.bucket_id INTEGER NOT NULL REFERENCES buckets(id)` - both existing flows,
   `wellness` (retired, but it owns every conversation from before 2026-10-05) and
   `antibiotics`, go to the antibiotics bucket.
3. `call_scripts.bucket_id INTEGER NOT NULL REFERENCES buckets(id)` - the one script,
   to antibiotics.
4. `flows_one_active_per_bucket` (unique on `bucket_id` where `is_active`) and
   `call_scripts_one_active_per_bucket`, **beside** the old `flows_one_active` and
   `call_scripts_one_active`, which stay: the code still reads "the active one" and
   relies on there being one. B08 drops the first, B18 the second.
5. `conversations.flow_id` made `NOT NULL` - the bucket comes from it. A guard first:
   the migration stops, naming the count, unless no conversation has a NULL `flow_id`.

The live checks that insert flows or scripts with no bucket
(`scripts/flows-live-check.ts`, `scripts/call-script-live-check.ts`) get one here,
in this ticket, so `live-checks.sh` stays green.

## Done when

- [ ] `scripts/flows-live-check.ts` and `scripts/call-script-live-check.ts`: the seeded
      bucket; every flow and script has one; two active flows in **one** bucket
      refused, by the constraint's name; one active flow in each of two buckets allowed
      by the new index but refused by the old one (proving it is still there); a flow
      with no bucket refused.
- [ ] `scripts/buckets-upgrade-check.ts` (B03): from the last migration, with the
      wellness flow's old conversations and the antibiotics ones seeded - every flow
      and script lands in antibiotics, no conversation is touched, `flow_id` is
      `NOT NULL`; and a seeded conversation with a NULL `flow_id` makes the migration
      stop.
- [ ] `scripts/live-checks.sh` all green; `npm test` unchanged.

## Tests

The two live checks and the upgrade check.

## Docs to update in the same commit

`docs/SCHEMA.md` (a `buckets` row; `flows`, `call_scripts`, `conversations` rows; the
indexes), `CLAUDE.md` §5 (the migration line), `docs/WORKFLOW.md` ("Where the files
stand"), `docs/FLOWS.md` (a flow belongs to a bucket), `docs/AUTO-CALLS.md` ("The
script": a script belongs to a bucket), `docs/BUCKETS.md` (the tracker row).

## Not in this ticket

Any code reading `bucket_id` (B08, B18); any other bucket column.

## As built

*Empty until the ticket is done.*

---

Design: `docs/BUCKETS.md`. Tracker: [`README.md`](README.md) - its rules and gates apply to every ticket. One branch off `dev`, merged `--no-ff`, code, tests and docs in one commit.
