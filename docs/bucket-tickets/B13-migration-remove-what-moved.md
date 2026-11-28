# B13 · Migration: remove what moved

**Goal:** the columns whose facts now live in `bucket_arrivals` or `buckets` - or that
were never used - are removed, so each fact is stored once.

**Why:** Jeel, 2026-11-27: the database stays clean, each fact in one place, copied
then removed (`BUCKETS.md`, "The database").

**Depends on:** B11, B12, B14, B23 · **Size:** S · **Status:** To do · **Deploy
note:** **a later deploy than B11, B14 and B23** - production must already run code
that no longer reads or writes these columns before they go. There is no rollback
after this one.

## Build

A migration (the next free number) that drops `leads.source`, `leads.group_id`,
`leads.group_name`, `leads.ezt_added_at`, `leads.previous_lead_id`,
`flows.ezt_group` and the index `idx_leads_received` (013).

**It stops, naming what it found, unless:**

- every lead with an arrival has a first arrival whose `ezt_added_at` and `source`
  equal the lead's columns (nothing differs that would be lost);
- `previous_lead_id` is NULL on every row;
- at most one distinct `group_name` is in `leads`, and if B21 has set the antibiotics
  bucket's group, it is that one - otherwise group data would be lost;
- `flows.ezt_group` is NULL on every row.

Any code still writing them goes in this ticket: `grep` for each column in `src` and
`scripts` must find nothing but migrations.

## Done when

- [ ] `scripts/remove-moved-upgrade-check.ts` (B03): from the previous migration with
      matching data, the columns are gone and nothing else changed; with one lead whose
      `source` differs from its arrival, the migration stops; the same for a non-NULL
      `previous_lead_id`, two group names, and a set `flows.ezt_group`.
- [ ] `grep` for every dropped column in `backend/src` and `backend/scripts` finds only
      migrations.
- [ ] `scripts/live-checks.sh`, `npm run e2e`, `npm run speed` pass.

## Tests

The upgrade check and the full suite.

## Docs to update in the same commit

`docs/SCHEMA.md` (the `leads` and `flows` rows; the index), `docs/WORKFLOW.md` ("Where the files stand": the
deploy-after rule), `docs/EZTEXTING-API.md` (the field mapping), `docs/BUCKETS.md`.

## Not in this ticket

The settings rows that move (B33, B35) - each leaves with the ticket that moves it.

## As built

*Empty until the ticket is done.*

---

Design: `docs/BUCKETS.md`. Tracker: [`README.md`](README.md) - its rules and gates apply to every ticket. One branch off `dev`, merged `--no-ff`, code, tests and docs in one commit.
