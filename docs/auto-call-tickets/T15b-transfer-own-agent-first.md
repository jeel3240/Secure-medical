# T15b · The transfer: the lead's own agent first

**Goal:** a lead who said yes reaches the agent who already has them, when
that agent is free.

**Depends on:** T15a · **Size:** - · **Status:** Done 2026-10-20 - real calls: rung
alone first, then the others; not free, not waited for · **Deploy note:** none.

## Build

- The lead is held by someone free -> ring only them, 25 seconds. (As built:
  marked `ring=group` all the same - below.)
- Not taken in 25 seconds -> everyone else free, as in T15a - not the holder
  who just let it ring. Whoever takes it holds the lead.
- The lead held by someone not free -> straight to everyone free.

**Files:** `backend/src/core/call-script.ts` (+ test),
`backend/src/integrations/twilio.ts` (+ test), `backend/src/api/twilio-webhooks.ts`,
`backend/src/api/__tests__/auto-call-webhooks.test.ts`, `backend/src/db/auto-calls.ts`,
`backend/scripts/auto-calls-live-check.ts`, `frontend/src/lib/incoming-state.ts`,
`frontend/src/lib/calling.ts` (comments only).

## Done when

- [x] Tests: holder free -> rung alone first (also beyond the first ten free);
      holder not free -> everyone free at once; not taken, or declined ->
      everyone else free, with nothing said and no notice again; nobody else
      free -> the busy line; the lead hung up while it rang -> nobody further
      rung; taken -> nothing more (`planTransfer`, `planAfterHolder`,
      `transferTwiml`, 53 webhook tests). A live check: the lead's holder in
      what a transfer reads, and none for a lead nobody holds
      (`auto-calls-live-check`, 77 checks).
- [x] Two browsers, a real call: lead held by A, A free -> only A rings; A
      does not take it -> B rings - 2026-10-20, call 25 (each rang its full
      time; Twilio's own log of the two rings).
- [x] Lead held by A, A not free - switch off (the same rule as on a call,
      `FREE_SQL`) -> only B rings, at once - call 26; B taking it takes the
      lead from A (`tookOverFrom`) - call 24.

## Docs to update in the same commit

`AUTO-CALLS.md`, "The transfer"; `TWILIO.md`, `FRONTEND.md`, `LOGGING.md`,
`README.md`, `CLAUDE.md`.

## As built

The lead's own agent's ring is marked **`ring=group`**, though they
ring alone - decided while building. The ring goes on without them if they
do not take it, which is what the browser's shared-ring rules are for: it
clears with no "Missed call" notice, and it is declined at once if they are
busy, so an open note box is never replaced. Unmarked, it would have been a
lead's own call to them, showing "Missed call" while a colleague talked to the
lead. The browser is unchanged. `/auto/after` is told who was rung alone
(`holder`) and the step, both in the address Twilio signs; a reload of the
ringing window counts as declining, and moves on too. The real calls also
showed Twilio's voicemail detection calling a person a machine - for T18,
below.

**From the real transfers' notes** (moved here from `AUTO-CALLS.md` on 2026-11-27, "The transfer"):

- **Reloading the window that is ringing turns the ring down** - Twilio reports
  `busy`, as for Decline - and the transfer goes on to the others (T15b, call
  24).
- **When the lead hangs up while it rings, Twilio says so**: `/auto/after`
  comes with `CallStatus=completed` (T15b, call 26), so nobody further is
  rung and nothing is said to an empty line.
- **Twilio's voicemail detection called a person a machine** (call 24): its
  verdict came after the lead had said "Yes." at 0.89, so the transfer went
  ahead, rightly - but the call's outcome was then saved as `voicemail`, as
  T12 did for any answered call a machine picked up. T18 does not act on a
  "machine" with no beep once the lead has answered, and such a call stays
  `answered` - `AUTO-CALL-SCRIPT.md`, "Voicemail".

---

Design: `docs/AUTO-CALLS.md`, `docs/AUTO-CALL-SCRIPT.md`, `docs/AUTO-CALL-TRANSFER.md`. Tracker:
[`README.md`](README.md). One branch off `dev`, one PR into `dev`, with its code, tests and
doc lines.
