# B28 · Queue: Needs review · 2 buckets

**Goal:** a person who arrived in a new bucket while active in another appears in the
queue tagged **Needs review · 2 buckets**, until an agent picks them up.

**Why:** `BUCKETS.md`, "Active in one bucket at a time", and decision 1 (Jeel,
2026-11-27): the tag clears when an agent picks the person up, as Inbound reply does.
A person partway through their questions is not in the queue at all today
(`INCLUDED`, `backend/src/db/queue.ts`), so the tag alone is not enough - they must be
let in.

**Depends on:** B09, B23 · **Size:** S · **Status:** To do · **Deploy note:** none.

## Build

- `backend/src/db/lead-state.ts`: `HELD_SQL` - the lead has an arrival with result
  `held` that no pick-up has followed - no `lead.picked_up` record in `activity_log`
  (written by `db/claims.ts`) after the arrival's `arrived_at`.
- `db/queue.ts`: `INCLUDED` lets a held person in (never one on the DNC list); the fact
  `held` with the held bucket's name.
- `backend/src/core/queue-tags.ts`: a kind `two_buckets`, placed directly above
  `needs_review` in the order; once an agent holds the person, `working` wins as it
  does for every tag.
- `frontend/src/components/QueueStatus.tsx`: "Needs review · 2 buckets", in the same
  style as the other tags - short, no sentence - with its icon from `StatusIcon`.
- The frontend `QueueTag` type.

## Done when

- [ ] `src/core/queue-tags.test.ts`: the new kind and its place in the order.
- [ ] `scripts/queue-live-check.ts`: a held person in the queue with the tag; after a
      pick-up, "Working - name"; after a release with nothing done, not tagged again
      (the held arrival has been picked up); on the DNC list, not in.
- [ ] `frontend/src/components/QueueStatus.test.tsx` (or the existing tag tests): the
      words and icon.

## Tests

The unit tests, the live check, the frontend test.

## Docs to update in the same commit

`docs/QUEUE.md` (who is in, the tag table, its rank), `docs/LEAD-FLOW.md`,
`docs/FRONTEND.md`, `docs/BUCKETS.md` (decision 1: built).

## Not in this ticket

Admin > Leads' status for held people (B29).

## As built

*Empty until the ticket is done.*

---

Design: `docs/BUCKETS.md`. Tracker: [`README.md`](README.md) - its rules and gates apply to every ticket. One branch off `dev`, merged `--no-ff`, code, tests and docs in one commit.
