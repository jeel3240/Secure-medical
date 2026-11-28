# T16 · The hold line

**Goal:** a "yes" that nobody took waits on hold when someone will be free
soon, and is never kept waiting for nobody.

**Depends on:** T15a · **Size:** - · **Status:** Done 2026-10-21 - real calls: on hold
with music, out when nobody is on a call, the safety stop · **Deploy note:** none.

## Build

- Nobody took it, and someone is on a call -> on hold: "All our agents are on
  other calls. Please stay on the line." then the lead's place: "You are
  next." / "You are number 2 in line.", then hold music.
- About every 30 seconds it checks again:
  - someone still on a call -> keep waiting, say the place again;
  - nobody on a call -> the busy line;
  - waited 10 minutes -> the busy line (safety stop).
- Nobody took it, and nobody is on a call -> the busy line at once.
- While anyone is on hold, the robot places no new calls (used by T20).

**Files:** `backend/src/db/migrations/019_hold_line.sql`,
`backend/src/core/call-script.ts` (+ test), `backend/src/core/call-script-fixtures.ts`,
`backend/src/db/call-script.ts`, `backend/src/db/auto-calls.ts`, `backend/src/db/presence.ts`,
`backend/src/core/activity.ts`, `backend/src/integrations/twilio.ts` (+ test),
`backend/src/integrations/twilio-calls.ts` (+ test), `backend/src/api/hold-watch.ts` (+ test),
`backend/src/api/index.ts`, `backend/src/api/twilio-webhooks.ts`,
`backend/src/api/__tests__/auto-call-webhooks.test.ts`, `backend/scripts/auto-calls-live-check.ts`,
`backend/scripts/presence-live-check.ts`, `backend/scripts/call-script-live-check.ts`.

## Done when

- [x] A real call on hold hears "You are next" and the music - 2026-10-21,
      call 40.
- [x] The other call ends without taking it -> the busy line within 30 s -
      6 seconds, call 40.
- [x] The safety stop works (tested with a short setting) - 1 minute, the
      busy line at 86 seconds, call 42.
- [x] "Is anyone on hold" is correct while waiting and after - a live check:
      on hold the first time only, recorded; first on hold first in line; the
      next moves up; hanging up on hold is `transfer_missed`; a call with its
      result cannot go on hold, nor a call that is not automated
      (`auto-calls-live-check`, 91 checks). Who counts as on a call: the
      switch on, active, a call going (`presence-live-check`, 50). Migration
      019 as agreed, and a place line that does not say the place refused
      (`call-script-live-check`, 33).
- [x] Tests: `planNobodyTook`, `holdGoesOn`, `placeLine`, a yes put on hold;
      the hold page - first, further back, nobody on a call, the safety stop,
      not on hold, hung up, 404 off, 403 unsigned; the hold TwiML and its
      tracks; the music cut short; the watcher - who it sends back, one look at
      a time, a failed look.

## Docs to update in the same commit

`AUTO-CALLS.md`, "The hold line"; `SCHEMA.md`, `AUDIT.md`, `LOGGING.md`,
`TWILIO.md`, `WORKFLOW.md`, `README.md`, `CLAUDE.md`.

## As built

`AUTO-CALL-TRANSFER.md`, "The hold line". Three changes from the plan. **The music is
Twilio's classical tracks, 5 to 10 minutes each** (Jeel's choice), so the
place is said when a track starts, not every 30 seconds; **the 30-second
checks are the server's own** - a watcher that cuts the music short - rather
than Twilio asking when the music ends. **No Twilio queue (`<Enqueue>`)**: the
place in line is counted from `held_at` in our database, which T17 needs
anyway to offer the first in line to whoever comes free. And a "yes" with
nobody free at all also waits on hold when someone is on a call, not only a
ring nobody took. The words are rows - `hold_next_body`, `hold_place_body`
(migration 019).

**What the real calls showed** (2026-10-21, Jeel's phone, nora "on a call" - a
call row added by hand in the local database for the test - moved here from `AUTO-CALLS.md` on 2026-11-27,
"The hold line"):

- **On hold, then out when nobody is on a call** (call 40): the yes, the hold
  line, "You are next." and a track; nora's call ended at 04:12:31, the
  watcher sent the lead back 6 seconds later, and the busy line - 69 seconds
  on hold, `transfer_missed`.
- **The safety stop** (call 42, set to 1 minute for the test): nora still on
  the call, the busy line after 86 seconds - the minute, then the watcher's
  next look.
- **Twilio asked `/auto/hold` twice as the music was cut**, the two requests
  alike: the first gave the busy line and ended the call, the second found it
  no longer on hold and said the same. The watcher's request is marked
  `via=watcher` and logged (`auto_call.hold_ended`) - the start of call 46's
  experiment (T17).

---

Design: `docs/AUTO-CALLS.md`, `docs/AUTO-CALL-SCRIPT.md`, `docs/AUTO-CALL-TRANSFER.md`. Tracker:
[`README.md`](README.md). One branch off `dev`, one PR into `dev`, with its code, tests and
doc lines.
