# B08 · The flow per bucket

**Goal:** the code asks for "the bucket's active flow", never "the active flow", and
the old one-active-flow index goes.

**Why:** today `startConversation` (`backend/src/db/flows.ts`) and Admin >
Configuration (`backend/src/db/admin-config.ts`) take the one flow `WHERE is_active`.
With a second bucket that is ambiguous.

**Depends on:** B07 · **Size:** S · **Status:** To do · **Deploy note:** a migration
that only drops an index; safe in any order.

## Build

- `backend/src/db/buckets.ts` (new):
  - `onlyBucket(q)` - the single bucket's id; throws a `MoreThanOneBucket` error when
    there are more. It is the poller's lookup until B23 and B24 give every arrival its
    own bucket - so a second bucket row cannot quietly get antibiotics' flow;
  - `bucketByKey(q, key)`.
- `db/flows.ts`, `startConversation(q, leadId, status, bucketId)`: `WHERE f.is_active
  AND f.bucket_id = $n`; the error text names the bucket.
- Callers: `worker/poller.ts` (`insertLead`, via `onlyBucket`);
  `scripts/dev-ask-again.ts` (the lead's current bucket - its newest conversation's
  flow's); `scripts/live-flow.ts`; the e2e.
- `db/admin-config.ts`: the flow shown is `onlyBucket`'s active flow, until B31's
  picker.
- Every script that seeds with `flow_id (SELECT id FROM flows WHERE is_active)`
  (`grep`, e.g. `scripts/queue-live-check.ts`) reads the bucket's flow instead.
- A migration dropping `flows_one_active` - nothing relies on it any more.

## Done when

- [ ] `scripts/flows-live-check.ts`: with a second bucket and its own active flow,
      `startConversation` gives each bucket its own flow's first question; two active
      flows in one bucket refused; `onlyBucket` throws once there are two buckets.
- [ ] `src/worker/poller.test.ts`: the bucket's id is passed; `MoreThanOneBucket`
      fails the poll loudly, without taking anyone in.
- [ ] `grep` finds no `WHERE is_active` on `flows` left in `src` or `scripts` without
      a bucket.
- [ ] `npm run e2e` passes.

## Tests

The live check, the poller unit test, the e2e.

## Docs to update in the same commit

`docs/FLOWS.md` ("Several flows at once"), `docs/SCHEMA.md` (the dropped index),
`CLAUDE.md` §5, `docs/WORKFLOW.md`, `docs/POLLER.md` (which flow a new lead gets).

## Not in this ticket

Admin's bucket picker (B31); the call script per bucket (B18).

## As built

*Empty until the ticket is done.*

---

Design: `docs/BUCKETS.md`. Tracker: [`README.md`](README.md) - its rules and gates apply to every ticket. One branch off `dev`, merged `--no-ff`, code, tests and docs in one commit.
