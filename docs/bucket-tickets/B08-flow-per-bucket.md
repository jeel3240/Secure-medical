# B08 · The flow per bucket

**Goal:** the code asks for "the bucket's active flow", never "the active flow", and
the old one-active-flow index goes.

**Why:** today `startConversation` (`backend/src/db/flows.ts`) and Admin >
Configuration (`backend/src/db/admin-config.ts`) take the one flow `WHERE is_active`.
With a second bucket that is ambiguous.

**Depends on:** B07 · **Size:** S · **Status:** Done 2026-11-28 - migration 027; the
flows live check, the poller's tests, every live check and the e2e pass · **Deploy
note:** a migration that only drops an index; safe in any order - the old code
still running reads "the active flow", and with one bucket there is still one.

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

- [x] `scripts/flows-live-check.ts`: with a second bucket and its own active flow,
      `startConversation` gives each bucket its own flow's first question; two active
      flows in one bucket refused; `onlyBucket` throws once there are two buckets.
- [x] `src/worker/poller.test.ts`: the bucket's id is passed; `MoreThanOneBucket`
      fails the poll loudly, without taking anyone in.
- [x] `grep` finds no `WHERE is_active` on `flows` left in `src` or `scripts` without
      a bucket - but in the two upgrade checks that seed before buckets existed.
- [x] `npm run e2e` passes.

## Tests

The live check, the poller unit test, the e2e.

## Docs to update in the same commit

`docs/FLOWS.md` ("Several flows at once"), `docs/SCHEMA.md` (the dropped index),
`docs/WORKFLOW.md`, `docs/POLLER.md` (which flow a new lead gets).

## Not in this ticket

Admin's bucket picker (B31); the call script per bucket (B18).

## As built

- **`db/buckets.ts`:**
  - `onlyBucket` is one query - the first bucket and how many there are - and
    throws `MoreThanOneBucket` (with the count) above one, or an error when there
    is none;
  - `bucketByKey` returns null for an unknown key.
- **The poller looks the bucket up once a poll, first** - before the checkpoint
  and before EZ Texting is read - and passes it down through `takeIn` and
  `insertLead` to `startConversation`. So a second bucket fails the whole poll
  (`poll.failed`, the checkpoint and the last-read time untouched), not each
  contact one by one, which B06 would have caught and counted as `failed`.
  `POLLER.md` rule 8.
- **`startConversation(q, leadId, status, bucketId)`.** Its error names the
  bucket. Its comment no longer says a failure holds the checkpoint: since B06
  the lead's transaction is rolled back and the next poll reads the contact
  again.
- **Callers the ticket did not list:**
  - `scripts/dev-auto-call.ts`, which gives a test lead a conversation, takes
    `onlyBucket`, as the poller does;
  - seven live checks call `startConversation` (agent-sms, auto-calls,
    auto-dial, flows, retry-openers, send-waiting-openers, timeline); they and
    the e2e take the antibiotics bucket, `antibiotics()` in `live-flow.ts`.
- **Seeds:** the eleven live checks that seed conversations by hand use
  `ANTIBIOTICS_FLOW` (`live-flow.ts`), the antibiotics bucket's active flow.
  The two upgrade checks keep "the active flow": they seed at 021 and 024, before
  buckets existed.
- **`dev-ask-again`:** a lead with no conversation gets `onlyBucket`'s.
- **`rolledBack` hands over its connection,** so the flows check runs the real
  `startConversation` and `onlyBucket` with a second bucket that never outlives
  the check.
- **Speed:** Admin > Configuration at 50,000 leads went from 7.7 ms to 8.8 ms
  (medians), the one more round trip `onlyBucket` makes. Left as it is: one page,
  read every 5 seconds.
- **Seen failing first:**
  - the poller's tests on the old poller - four fail: the bucket on each insert,
    and the second bucket;
  - the flows live check with `startConversation` ignoring the bucket - it stops
    on a second conversation for the same lead;
  - the flows live check without 027 - four fail.
- **Runs:**
  - every live check (26): flows 43, call-script 39;
  - the e2e, 143;
  - the speed check at 50,000;
  - backend 1,996 tests;
  - lint, both type checks, the image build.
- **Docs:** `FLOWS.md` (rule 1, How to add one, Code, Tests, Not done), `POLLER.md`
  (step 5, rule 8, Code, Tests), `SCHEMA.md`, `WORKFLOW.md`, `ADMIN.md`,
  `LOGGING.md` (`poll.failed`), `DEPLOY.md` (a second bucket stopping the poller),
  `TESTING.md`, `BUCKETS.md`.

---

Design: `docs/BUCKETS.md`. Tracker: [`README.md`](README.md) - its rules and gates apply to every ticket. One branch off `dev`, merged `--no-ff`, code, tests and docs in one commit.
