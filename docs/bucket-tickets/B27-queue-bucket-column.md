# B27 · Queue: Bucket column and filter

**Goal:** agents see each lead's bucket in the queue and can filter by it.

**Why:** `BUCKETS.md`, "What follows the lead's bucket": one queue for everyone, with
a Bucket column and a Bucket filter.

**Depends on:** B07 · **Size:** M · **Status:** To do · **Deploy note:** none.

## Build

- `backend/src/db/queue.ts`:
  - each row's `bucket` - `{ key, name }` of the newest conversation's flow's bucket;
  - a `bucket` filter (a list of keys) beside the source filter in the page filters;
  - counts per bucket, worked out like the source counts (each ignoring its own
    filter);
  - the list of buckets, for the filter.
- `backend/src/api/leads.ts`: `bucket` parsed with `parseList`, checked against the
  known keys - an unknown key is 400 `invalid_bucket`.
- Frontend:
  - `frontend/src/api/leads.ts`: the types;
  - `frontend/src/pages/QueuePage.tsx`: a Bucket column after Lead and a Bucket
    filter beside Source. **Both shown only when there is more than one bucket** -
    with one, the screen is exactly today's.
- The status column and its tags are unchanged (B28 adds the new one).

## Done when

- [ ] `scripts/queue-live-check.ts`: a lead's bucket is its newest conversation's;
      the filter keeps only that bucket's leads; the counts; an unknown key refused.
- [ ] `src/api/__tests__` (the queue route): `invalid_bucket`.
- [ ] `frontend/src/pages/QueuePage.test.ts`: the column and filter hidden with one
      bucket, shown with two.
- [ ] `npm run speed -- 50000`: the queue's timings - numbers in *As built*.

## Tests

The live check, the route and page tests, the speed check.

## Docs to update in the same commit

`docs/QUEUE.md` (columns and filters), `docs/FRONTEND.md`, `docs/BUCKETS.md`.

## Not in this ticket

The **Needs review · 2 buckets** tag (B28); Admin > Leads (B29).

## As built

*Empty until the ticket is done.*

---

Design: `docs/BUCKETS.md`. Tracker: [`README.md`](README.md) - its rules and gates apply to every ticket. One branch off `dev`, merged `--no-ff`, code, tests and docs in one commit.
