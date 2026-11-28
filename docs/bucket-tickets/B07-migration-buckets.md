# B07 · Migration: buckets

**Goal:** the database knows buckets. Antibiotics becomes the first one, and every flow
and call script belongs to a bucket - with nothing changing for anyone.

**Why:** `BUCKETS.md`, "The database". Every later ticket hangs off a bucket id.

**Depends on:** B03 · **Size:** S · **Status:** Done 2026-11-28 - migration 026; the
flows and call-script live checks, the buckets upgrade check, every live check and
the e2e pass ·
**Deploy note:** additive; the old code ignores the new table and columns, and
already gives every conversation a flow.

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

- [x] `scripts/flows-live-check.ts` and `scripts/call-script-live-check.ts`: the seeded
      bucket; every flow and script has one; two active flows in **one** bucket
      refused, by the constraint's name; one active flow in each of two buckets allowed
      by the new index but refused by the old one (proving it is still there); a flow
      with no bucket refused.
- [x] `scripts/buckets-upgrade-check.ts` (B03): from the last migration, with the
      wellness flow's old conversations and the antibiotics ones seeded - every flow
      and script lands in antibiotics, no conversation is touched, `flow_id` is
      `NOT NULL`; and a seeded conversation with a NULL `flow_id` makes the migration
      stop.
- [x] `scripts/live-checks.sh` all green; `npm test` unchanged.

## Tests

The two live checks and the upgrade check.

## Docs to update in the same commit

`docs/SCHEMA.md` (a `buckets` row; `flows`, `call_scripts`, `conversations` rows; the
indexes), `docs/WORKFLOW.md` ("Where the files
stand"), `docs/FLOWS.md` (a flow belongs to a bucket), `docs/AUTO-CALL-SCRIPT.md` ("The
script": a script belongs to a bucket), `docs/BUCKETS.md` (the tracker row).

## Not in this ticket

Any code reading `bucket_id` (B08, B18); any other bucket column.

## As built

- **The migration:** `026_buckets.sql`. `buckets` has `key` and `name`, each unique by
  a named constraint (`buckets_key_unique`, `buckets_name_unique`), and `created_at`.
  Each `bucket_id` is added, filled in, then made `NOT NULL`, with its foreign key
  named (`flows_bucket_fk`, `call_scripts_bucket_fk`). The guard counts the
  conversations with no `flow_id` and stops before anything is required.
- **Built differently - every conversation a script writes now has a flow.**
  Making `conversations.flow_id` required broke more than the two live checks the
  ticket named. Eleven live checks inserted 22 conversations with no flow, and
  nine of them stopped at the first insert. Each now gives the active flow -
  `(SELECT id FROM flows WHERE is_active)` - as the upgrade checks, the queue check
  and the speed check already did. B10's seed helper replaces them all. No code
  in `src/` writes a conversation without a flow: `startConversation` is the only
  writer, and it sets one.
- **`rolledBack`, in `scripts/check.ts`.** Both indexes refuse a second active flow
  in one bucket, and only the old one refuses an active flow in a second bucket.
  To see each by name, the checks drop the old index, or add a second bucket,
  inside a transaction that is always rolled back. Each statement runs in a
  savepoint, so a refusal does not end it, and nothing outlives the check.
- **Seen failing first,** on 026 broken three ways:
  - without the guard, the upgrade check fails, "026 stops, and says how many";
  - with the old indexes dropped, both live checks fail, "the old index, still
    there, refuses it";
  - without the per-bucket indexes, both fail, "refused, by the bucket's index".
- **Runs:**
  - every live check, 26, the buckets upgrade check among them: flows 38,
    call-script 39, buckets upgrade 13;
  - the e2e, 143;
  - a 2,000-lead speed check, its seed writing conversations;
  - backend 1,995 tests, unchanged;
  - lint, both type checks, the image build.
- **Docs:** `SCHEMA.md`, `WORKFLOW.md` ("Where the files stand"), `FLOWS.md` (rules 1
  and 4, How to add one, Not done), `AUTO-CALL-SCRIPT.md`, `BUCKETS.md`,
  `TESTING.md` (`check.ts`'s helpers).

---

Design: `docs/BUCKETS.md`. Tracker: [`README.md`](README.md) - its rules and gates apply to every ticket. One branch off `dev`, merged `--no-ff`, code, tests and docs in one commit.
