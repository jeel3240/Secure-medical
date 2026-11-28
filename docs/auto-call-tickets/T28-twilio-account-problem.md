# T28 · A Twilio account problem never uses up a lead's call

**Goal:** a problem with our own Twilio account - a wrong key, the account
suspended, too many requests - costs no lead its one robot call. Found in a
review, 2026-10-29; Jeel: fix it before the deploy.

**Depends on:** T20 · **Size:** - · **Status:** Done 2026-10-29 - refused for our
account: not the lead's call, and a 15-minute pause · **Deploy note:** none until a
refusal happens.

## Build

(as built: `AUTO-CALLS.md`, "When Twilio refuses")

- A refusal for the lead's own number stays the lead's call; any other is
  `not_placed`, the lead still due - and so is a call Twilio never confirmed.
- The robot stops that look at once, and pauses 15 minutes after a
  `not_placed`, logged once.
- Three `not_placed` and the lead's call counts as used.
- `calls_one_automated_per_lead` leaves `not_placed` rows out; migration 014
  changed in place, since production has not run it.
- No screen shows a `not_placed` call.

**Files:** `backend/src/db/migrations/014_automated_calls.sql`,
`backend/src/core/auto-dial.ts` (+ test), `backend/src/db/auto-calls.ts`,
`backend/src/db/auto-dial.ts`, `backend/src/worker/place-auto-call.ts`
(+ test), `backend/src/worker/auto-calls.ts` (+ test),
`backend/src/worker/index.ts`, `backend/src/db/leads.ts`,
`backend/src/db/timeline.ts`, `backend/scripts/dev-auto-call.ts`, and the
live checks above.

## Done when

- [x] Tests: whose refusal it is, by Twilio's code; no calls while refused;
      the look ends at a `not_placed` or an unanswered request; placing a
      call refused for our account (401, 429, 403 with no code) (1,053
      backend tests).
- [x] A live check: refused for the number - the lead's call, never again;
      refused for our account - `not_placed`, recorded, the lead called
      again, the database refusing a second row while one is placed, used
      after three (`auto-calls-live-check`, 124); a `not_placed` lead still
      due, after one not tried, until three; the pause for 15 minutes, not
      for a refused number; a call never confirmed closed `not_placed`
      (`auto-dial-live-check`, 67); Admin > Leads Not called
      (`admin-leads-live-check`, 53); not on the timeline
      (`timeline-live-check`, 31).
- [x] Migration 014 as changed, on a fresh database and on the local one;
      `npm run speed` - Admin > Leads unchanged, filtering one call result 39
      ms at 50,000 leads.

## Docs to update in the same commit

`AUTO-CALLS.md` ("When Twilio refuses", "Traffic", "How a call is
placed"); `SCHEMA.md`, `TWILIO.md`, `AUDIT.md`, `LOGGING.md`,
`ADMIN-LEADS.md`, `README.md`, `CLAUDE.md`.

## As built

Built as *Build* says.

---

Design: `docs/AUTO-CALLS.md`, `docs/AUTO-CALL-SCRIPT.md`, `docs/AUTO-CALL-TRANSFER.md`. Tracker:
[`README.md`](README.md). One branch off `dev`, one PR into `dev`, with its code, tests and
doc lines.
