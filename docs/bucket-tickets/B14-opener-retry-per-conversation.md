# B14 · First-question retry and resend per conversation

**Goal:** a new bucket's first question is retried, and can be resent after an outage,
exactly like a first lead's - its rules look at its own conversation, not the lead's
whole past.

**Why:** `backend/src/db/openers-never-sent.ts` (`findOpenersNeverSent`, `FAILED_OPENERS`)
excludes a lead who **ever** texted in or got a text from us, counts **every** failed
automated send the lead ever had, and its 24 hours run from the lead's first arrival;
`backend/src/worker/send-waiting-openers.ts`'s `NOBODY_HAS_WORKED_IT` is lead-wide too
(survey and review, 2026-11-27). A returning person's failed weight-loss opener would
never be retried.

**Depends on:** B11 · **Size:** S · **Status:** To do · **Deploy note:** none.

## Build

- `findOpenersNeverSent`: every condition from the conversation's start
  (`c.created_at`) - no inbound since, no outbound that is not `failed` since, failed
  openers counted since; `arrivedAt` is the conversation's own arrival (the arrival
  whose `conversation_id` is `c.id`), falling back to `c.created_at`.
- `worker/retry-openers.ts`: `retryGaveUp`'s 24 hours and attempt count work on those
  values - no other change to its schedule.
- `send-waiting-openers.ts`: `NOBODY_HAS_WORKED_IT` since the conversation began; the
  from/to window on the conversation's arrival.
- `messages` has no `conversation_id`; "since the conversation began" is the scoping,
  written once as a shared SQL fragment in `db/lead-state.ts`, used by both.

## Done when

- [ ] `scripts/retry-openers-live-check.ts`: a lead whose first conversation finished,
      with a second whose opener failed, is retried; its 24 hours run from the second
      arrival; the first conversation's failures and replies do not count; every
      existing case unchanged.
- [ ] `scripts/send-waiting-openers-live-check.ts`: the same lead is resendable; one
      whose second conversation was worked is not.

## Tests

The two live checks.

## Docs to update in the same commit

`docs/POLLER.md` ("Retrying a failed opener", "Resending after an outage"),
`docs/BUCKETS.md`.

## Not in this ticket

Texts switched off per bucket (B26).

## As built

*Empty until the ticket is done.*

---

Design: `docs/BUCKETS.md`. Tracker: [`README.md`](README.md) - its rules and gates apply to every ticket. One branch off `dev`, merged `--no-ff`, code, tests and docs in one commit.
