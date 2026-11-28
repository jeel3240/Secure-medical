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

**Depends on:** - · **Size:** S · **Status:** To do · **Deploy note:** none.

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

- [ ] `src/worker/poller.test.ts`: one contact's insert throws - the others are taken
      in and texted, `failed` is 1, the checkpoint stops before the failed one, and a
      second poll takes it in; a DNC check that throws for one contact - the same;
      `ezt_last_read_at` written on a quiet poll and on a poll with a failure, not on a
      poll whose fetch failed.
- [ ] `scripts/health-live-check.ts`: last poll read from `ezt_last_read_at`, the
      fallback when it is missing.
- [ ] `scripts/admin-leads-live-check.ts` or the admin live check: "Synced" from the
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

*Empty until the ticket is done.*

---

Design: `docs/BUCKETS.md`. Tracker: [`README.md`](README.md) - its rules and gates apply to every ticket. One branch off `dev`, merged `--no-ff`, code, tests and docs in one commit.
