# B24 · The two-group read

**Goal:** the poller reads everyone in each bucket's main group, takes each one in, and
moves them to the "- taken" group - finding people by group membership, never by date.

**Why:** a contact already on EZ Texting keeps its `createdAt` when it joins another
group (tested 2026-11-27, `EZTEXTING-API.md`), so the date-based poller can never see
a returning person. `BUCKETS.md`, "Finding people: two groups per bucket".

**Depends on:** B06, B14, B17, B20, B21, B23, B28, B33, B34 · **Size:** M ·
**Status:** Waits on the client's OK for two groups · **Deploy note:** **deploys with
B25, never alone** - without the switch-over, the first read would text every old
contact in the antibiotics group.

## Build

`backend/src/worker/poller.ts`, `pollOnce`, rewritten:

- for each bucket with its groups set, in bucket id order (decision 6: when one person
  arrives in two buckets in one read, the lower id takes them and the other holds
  them, because the first `takeIn` has already started a conversation):
  1. read every contact in the main group - all pages at 200, the source filter as
     today, membership re-checked by the group's **id** (`groups[]`);
  2. per contact, isolated (B06): `takeIn`; the first question if owed; then
     `moveContact` to the taken group and `moved_at` filled;
  3. a contact still in the main group whose arrival in this bucket is unmoved: only
     the move is retried - never a second arrival, never a second text;
  4. a 429 ends the moves for this cycle; the rest go next time.
- No checkpoint and no `createdAt` cutoff - B25 removes them.
- `poll.tick`'s stats per bucket (`bucketId`, read, taken in, held, moved, failed).
- `src/worker/poller.test.ts` rewritten: the checkpoint and overlap cases go; new cases
  for the read, the move, the retry, the isolation and the bucket order.

## Done when

- [ ] `src/worker/poller.test.ts`: every case above, with the client mocked.
- [ ] `scripts/poller-live-check.ts` (new; the real `pollOnce` against a real
      database, the client replaced as `activity-live-check.ts` does): a new contact
      taken in, texted and moved; a returning person held or started by B22's rules;
      an unmoved arrival moved on the next cycle without a text; two buckets in one
      read.
- [ ] `npm run e2e` passes (B43 adds a step that drives this poller).

## Tests

The unit tests and the new live check.

## Docs to update in the same commit

`docs/POLLER.md` (rewritten: a cycle, why each piece is there, what it never does),
`docs/LOGGING.md`, `docs/EZTEXTING-API.md` (the poller's calls), `docs/LEAD-FLOW.md`,
`docs/BUCKETS.md`.

## Not in this ticket

The switch-over and `EZT_GROUP` (B25); the texts switch (B26).

## As built

*Empty until the ticket is done.*

---

Design: `docs/BUCKETS.md`. Tracker: [`README.md`](README.md) - its rules and gates apply to every ticket. One branch off `dev`, merged `--no-ff`, code, tests and docs in one commit.
