# B06 · Poller: one contact never stops the rest

**Goal:** a failure on one contact never stops the rest of a poll, and the app records
when it last read EZ Texting apart from the checkpoint.

**Why:** in `backend/src/worker/poller.ts`, `pollOnce` catches errors only around the
first question's send (`openLead`). An error in `insertLead`, `isOnDnc` or
`startConversation` for one contact fails the whole poll and leaves the checkpoint
where it was (survey, 2026-11-27). And health (`db/health.ts`) and Admin > Leads'
"Synced" (`db/leads.ts`, `lastPollAt`) read the checkpoint row's `updated_at` as "last
polled" - the checkpoint goes in B25, so they need their own signal first. Useful on
its own, today.

**Depends on:** - · **Size:** S · **Status:** Done 2026-11-28 - the poller's tests,
the health and Admin > Leads live checks, the e2e · **Deploy note:** none.

## Build

- `pollOnce`: each contact handled in its own `try`/`catch`. A failure logs
  `poll.contact_failed` with the error text and no phone or name, adds to a new
  `failed` count in `PollStats`, and the walk goes on.
- The checkpoint after a failure: it may advance only to just before the **oldest**
  failed contact's `createdAt`, so that contact is read again next poll. Contacts after
  it that succeeded are skipped next time as known phones (`ON CONFLICT DO NOTHING`).
- A `settings` row `ezt_last_read_at`, upserted at the end of every poll that reached
  EZ Texting - failures or not.
- `db/health.ts` (the poller check) and `db/leads.ts` (`lastPollAt`) read
  `ezt_last_read_at`, falling back to the checkpoint's `updated_at` until it exists.

## Done when

- [x] `src/worker/poller.test.ts`: one contact's insert throws - the others are taken
      in and texted, `failed` is 1, the checkpoint stops before the failed one, and a
      second poll takes it in; a DNC check that throws for one contact - the same;
      `ezt_last_read_at` written on a quiet poll and on a poll with a failure, not on a
      poll whose fetch failed.
- [x] `scripts/health-live-check.ts`: last poll read from `ezt_last_read_at`, the
      fallback when it is missing.
- [x] `scripts/admin-leads-live-check.ts` or the admin live check: "Synced" from the
      new row.

## Tests

Unit tests (the poller is mocked at its edges, as today); the two live checks.

## Docs to update in the same commit

`docs/POLLER.md` ("A cycle", "Why each piece is there", "Reading the log");
`docs/LOGGING.md` (`poll.contact_failed`; `poll.tick`'s `failed`; health's source);
`docs/ADMIN-LEADS.md` if it names where "Synced" comes from.

## Not in this ticket

Reading groups by membership (B24); the checkpoint's removal (B25).

## As built

- **`takeIn`** in `worker/poller.ts` is one contact - the group check, the
  do-not-call check, the insert, the first question - and `pollOnce` calls it in a
  `try`; a throw logs `poll.contact_failed` (`createdAt`, `err`), adds to
  `PollStats.failed`, and marks the oldest failed time. `poll.tick` logs `failed`.
- **The checkpoint after a failure** is one millisecond before the oldest failed
  contact's `createdAt`, when that is earlier than what the poll reached - which
  can be earlier than the checkpoint it read, for a contact that failed inside the
  overlap (a test for that case). A contact that fails every time holds it there;
  `POLLER.md` says so under "Not done".
- **`db/poll-state.ts`** holds the two keys, `markEztRead` (the poller's write,
  after the checkpoint's) and `LAST_READ_AT_SQL` - `ezt_last_read_at`'s
  `updated_at`, else the checkpoint row's - which `db/health.ts` and `db/leads.ts`
  both read, so the two screens cannot disagree. The row needs no migration: the
  poller upserts it, as it does the checkpoint.
- **Tests seen failing first:** the poller suite does not compile on the old poller
  (no `failed` on `PollStats`), and the old one threw on the first failed contact;
  on the old readers, two health checks and the "Synced" check failed.
- **Runs:** the poller's 33 tests; the health live check (33) and the Admin > Leads
  one (59), the sections before "when EZ Texting was last read" proving the
  fallback; every live check (25); the e2e, 143; backend 1,994 tests; lint, types,
  the image build.
- **Also:** `SCHEMA.md`'s `settings` rows, `ADMIN-LEADS.md`'s sync line and data.
- **Reviewed 2026-11-28, after group A:** the next poll taking a failed contact in
  was tested only after an insert failure; the same test runs for a do-not-call
  check that threw (34 tests; both fail when the checkpoint is not held back).
  Docs the commit missed: `DEPLOY.md` had no row for a refused contact - which the
  health check does not show - and its first row said EZ Texting failing logs a
  `poll.tick`, when it logs `poll.failed`; `LOGGING.md`'s `poll.failed` named only
  EZ Texting's failures; `SCHEMA.md`'s readers of the two poll rows; `RUNNING.md`'s
  sample line; `ADMIN-LEADS.md`'s Tests; `BUCKETS.md`'s Status.

---

Design: `docs/BUCKETS.md`. Tracker: [`README.md`](README.md) - its rules and gates apply to every ticket. One branch off `dev`, merged `--no-ff`, code, tests and docs in one commit.
