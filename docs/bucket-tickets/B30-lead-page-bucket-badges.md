# B30 · Lead page: the person's buckets

**Goal:** the lead page and the timeline page show every bucket the person has been
in, and the SMS box says which bucket's questions an agent's text would stop.

**Why:** `BUCKETS.md`, "One person, one lead": the same agent works a person across
buckets and must see all of them. Rule 2b - an agent's text stops the automated
questions - now stops a named bucket's (review, 2026-11-27).

**Depends on:** B09, B12 · **Size:** S · **Status:** To do · **Deploy note:** none.

## Build

- `backend/src/db/lead-detail.ts`: `buckets` - each bucket the person arrived in, from
  `bucket_arrivals`: key, name, whether it is the current one, whether it is held.
- `frontend/src/pages/workspace/LeadHeader.tsx` and
  `frontend/src/pages/LeadTimelinePage.tsx`: the buckets as small badges (the existing
  `Badge` component), the current one first; held marked "held". With one bucket, one
  badge.
- `frontend/src/pages/workspace/SmsCompose.tsx`: where it already works out that a
  text would stop the questions, the note names the bucket - short, in the page's
  style.

## Done when

- [ ] `scripts/lead-detail-live-check.ts`: `buckets` for a lead with one, two, and a
      held bucket.
- [ ] Frontend tests: the badges; the SMS note's bucket.

## Tests

The live check and the frontend tests.

## Docs to update in the same commit

`docs/AGENT-WORKSPACE.md`, `docs/FRONTEND.md`, `docs/BUCKETS.md`.

## Not in this ticket

The queue (B27, B28).

## As built

*Empty until the ticket is done.*

---

Design: `docs/BUCKETS.md`. Tracker: [`README.md`](README.md) - its rules and gates apply to every ticket. One branch off `dev`, merged `--no-ff`, code, tests and docs in one commit.
