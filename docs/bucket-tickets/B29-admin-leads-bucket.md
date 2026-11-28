# B29 · Admin > Leads: Bucket column and filter

**Goal:** Admin > Leads shows each lead's bucket, filters by it, and counts held
people under Needs review.

**Why:** `BUCKETS.md`, "What follows the lead's bucket"; decision 1 (Jeel,
2026-11-27): held people count under Needs review.

**Depends on:** B07, B28 · **Size:** S · **Status:** To do · **Deploy note:** none.

## Build

- `backend/src/db/leads.ts`: the row's `bucket`; a `bucket` filter in `buildFilters`;
  the bucket list for the dropdown; `STATUS_SQL` reads `needs_review` for a held person
  (`HELD_SQL`, B28), at its place in the order.
- `backend/src/api/admin/leads.ts`: `bucket` parsed and checked - 400
  `invalid_bucket`.
- `frontend/src/pages/admin/LeadsPage.tsx`: a Bucket column and filter, shown only with
  more than one bucket; `frontend/src/lib/leads-view.ts`: `bucket` kept in the address
  and **validated** against the known buckets (the source filter is not validated
  today - this one is).

## Done when

- [ ] `scripts/admin-leads-live-check.ts`: the bucket, the filter, a held person under
      Needs review.
- [ ] Route test: `invalid_bucket`.
- [ ] `frontend/src/lib/leads-view.test.ts`: `bucket` read, written, validated;
      `LeadsPage` tests: hidden with one bucket.
- [ ] `npm run speed`: Admin > Leads' timings.

## Tests

As above.

## Docs to update in the same commit

`docs/ADMIN-LEADS.md`, `docs/FRONTEND.md`, `docs/BUCKETS.md`.

## Not in this ticket

Any other status change.

## As built

*Empty until the ticket is done.*

---

Design: `docs/BUCKETS.md`. Tracker: [`README.md`](README.md) - its rules and gates apply to every ticket. One branch off `dev`, merged `--no-ff`, code, tests and docs in one commit.
