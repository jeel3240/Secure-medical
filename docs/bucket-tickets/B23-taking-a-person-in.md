# B23 · Taking a person in

**Goal:** one transaction takes a contact into a bucket: it gathers the facts, asks
`decideArrival`, and writes the lead, the conversation, the arrival and any block -
and today's poller uses it, so it runs on production before anything else changes.

**Why:** the rules (B22) need one place that acts on them atomically. Replacing
`insertLead` (`backend/src/worker/poller.ts`) now proves it on real traffic with one
bucket.

**Depends on:** B08, B09, B22 · **Size:** M · **Status:** To do · **Deploy note:**
none.

## Build

`backend/src/db/arrivals.ts`:

- `arrivalFacts(client, leadId, bucketId)` - one query for everything B22 needs.
- `takeIn(contact, bucketId)`, one transaction:
  1. find the lead by phone and lock it (`FOR UPDATE`), or insert it
     (`ON CONFLICT (phone)`), so two takes for one phone cannot both start a
     conversation;
  2. **skip** if this person already has an unmoved arrival in this bucket - today's
     poller re-reads contacts inside its 5-minute overlap, and until B24 moves people
     nothing is ever moved, so this keeps one arrival per person per bucket, as
     "known phone skipped" does today;
  3. expire an open conversation already past its expiry - the poll runs before the
     expiry sweep (`worker/index.ts`), and `one_open_conversation_per_lead` would
     refuse the new one;
  4. `decideArrival(arrivalFacts(...))`;
  5. act: the conversation (`startConversation` with the bucket), the arrival
     (`recordArrival`), the block (`blockNumber`);
  6. return whether a first question is owed - sent by the caller after the commit,
     as today.
- `worker/poller.ts`: `insertLead` replaced by `takeIn(contact, onlyBucket)`.

## Done when

- [ ] `scripts/arrivals-live-check.ts`, against a real database: every decision row
      of B22, end to end - the rows written, nothing else; a stale open conversation
      expired, then started; the skip; two `takeIn`s racing for one phone - one lead,
      one conversation.
- [ ] `src/worker/poller.test.ts` updated: the poller calls `takeIn`, then the opener
      when one is owed.
- [ ] `scripts/activity-live-check.ts`'s real `pollOnce` run passes - opted out,
      blocked, the block kept.
- [ ] `npm run e2e` passes.

## Tests

The live checks; the poller unit test; the e2e.

## Docs to update in the same commit

`docs/POLLER.md` (a cycle: `takeIn`), `docs/STATE-MACHINE.md` ("A number that comes
back": built, for one bucket), `docs/BUCKETS.md`.

## Not in this ticket

Reading groups by membership and moving people (B24).

## As built

*Empty until the ticket is done.*

---

Design: `docs/BUCKETS.md`. Tracker: [`README.md`](README.md) - its rules and gates apply to every ticket. One branch off `dev`, merged `--no-ff`, code, tests and docs in one commit.
