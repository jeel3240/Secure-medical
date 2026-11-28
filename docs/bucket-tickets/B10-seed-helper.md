# B10 · One seed helper for tests and scripts

**Goal:** every live check, script and test that makes a lead does it through one
helper, which writes the lead, its conversation and its arrival as the app does.

**Why:** about fifteen scripts insert into `leads` directly and set `ezt_added_at` or
`source` to control a lead's age (survey, 2026-11-27: e.g. `scripts/end-to-end.ts`,
`retry-openers-live-check.ts`, `send-waiting-openers-live-check.ts`,
`queue-live-check.ts`'s `lead()`, `dev-auto-call.ts`, `speed-check.ts`). When B11 reads
age from arrivals, all of them would break, and B13 drops the columns they write.

**Depends on:** B09 · **Size:** M · **Status:** To do · **Deploy note:** none - test
code only.

## Build

- `backend/scripts/seed.ts` (new): `seedLead(q, options)` - phone, names, source, when
  received, bucket (default antibiotics), conversation status and step, score and
  tier. Writes the lead, a conversation on the bucket's active flow and its arrival,
  in one transaction, the way the poller does; returns the ids. Typed, documented, no
  defaults that hide a field a check depends on.
- Every script and live check that inserts a lead moves to it (`grep` for `INSERT INTO
  leads` in `backend/scripts`). The e2e, `dev-auto-call.ts` and `speed-check.ts`
  included - `speed-check.ts` keeps its bulk `generate_series` load but writes
  arrivals alongside and stops writing `group_name`.
- Unit tests that build fake rows (`queue.test.ts`, `lead-detail.test.ts`,
  `timeline.test.ts`) are unaffected - they mock rows, not the database.

## Done when

- [ ] `grep "INSERT INTO leads" backend/scripts` finds only `seed.ts` and upgrade
      checks seeding old shapes.
- [ ] `scripts/live-checks.sh`, `npm run e2e` and `npm run speed -- 50000` all pass
      with no other change - the check counts unchanged, listed in *As built*.

## Tests

The whole live-check suite, the e2e and the speed check are the test of a test helper.

## Docs to update in the same commit

`docs/README.md` ("How to test": seed with `seedLead`).

## Not in this ticket

Any change to what a check proves.

## As built

*Empty until the ticket is done.*

---

Design: `docs/BUCKETS.md`. Tracker: [`README.md`](README.md) - its rules and gates apply to every ticket. One branch off `dev`, merged `--no-ff`, code, tests and docs in one commit.
