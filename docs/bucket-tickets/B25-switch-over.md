# B25 · The switch-over, and `EZT_GROUP` retired

**Goal:** the first time a bucket is read the new way, everyone already in its main
group is moved to "- taken" **without a text**, and the old date-based settings and
`EZT_GROUP` go.

**Why:** the antibiotics group holds every lead the app has ever taken in, and older
contacts it never took in. B24 alone would text all of them. `BUCKETS.md`, "The
switch-over".

**Depends on:** B24 · **Size:** S · **Status:** Waits on the client's OK for two groups
· **Deploy note:** **deploys with B24.**

## Build

- **Migration:** `buckets.switched_over_at` (empty until done).
- In `pollOnce`, before a bucket's normal read, while its `switched_over_at` is empty:
  - `ensureTakenGroup` (B21) - the taken group is made here, after the client's OK;
  - every contact in the main group is moved to "- taken" without a text, except a
    contact newer than the old `ezt_poll_checkpoint` - that one is taken in as usual,
    so nobody arriving at that moment is lost;
  - every arrival in the bucket from before has its `moved_at` filled - otherwise an
    unmoved backfilled arrival would stop a real return from ever being texted;
  - in batches per cycle, at the rate B20 measured; `switched_over_at` set when the
    group holds no one from before;
  - recorded as `bucket.switched_over`, keeping the counts moved and taken in, and the
    old checkpoint's value - the only record of it.
- **Migration** (a later deploy, after the switch-over is seen done): the
  `ezt_poll_checkpoint` and `poll_overlap_minutes` rows deleted.
- `EZT_GROUP` retired: `backend/src/config.ts`'s required list; `docker-compose.yml`;
  `.env.example`; `scripts/live-checks.sh`; `scripts/activity-live-check.ts`. B21's
  `fillGroupsFromEnv` is removed once every environment's antibiotics group is set.

## Done when

- [ ] `scripts/poller-live-check.ts`: a group holding old leads, old contacts the app
      never took in, and one contact newer than the checkpoint - after the switch-over,
      only the new one was texted; everyone was moved; every old arrival has
      `moved_at`; `switched_over_at` set; the record kept.
- [ ] The switch-over runs once: a second cycle does nothing of it.
- [ ] `grep EZT_GROUP` finds only dated notes in docs.
- [ ] `npm test`, `scripts/live-checks.sh`, `npm run e2e` pass without `EZT_GROUP` set.

## Tests

The live check, the suite without the variable.

## Docs to update in the same commit

`docs/POLLER.md` (the switch-over; the checkpoint retired), `docs/ENVIRONMENT.md` (`EZT_GROUP` retired), `docs/RUNNING.md` (where it names `EZT_GROUP`), `docs/AUDIT.md`
(`bucket.switched_over`), `docs/LOGGING.md`, `docs/SCHEMA.md`, `docs/WORKFLOW.md`,
`docs/BUCKETS.md`.

## Not in this ticket

Watching it on production (B46).

## As built

*Empty until the ticket is done.*

---

Design: `docs/BUCKETS.md`. Tracker: [`README.md`](README.md) - its rules and gates apply to every ticket. One branch off `dev`, merged `--no-ff`, code, tests and docs in one commit.
