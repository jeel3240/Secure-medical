# T15c · Letting a transfer ring out turns the switch off

**Goal:** a desk left with "Taking calls" on stops being rung after one
missed transfer, and its screen says so.

**Depends on:** T15a · **Size:** - · **Status:** Done 2026-10-20 - real calls: ran
out, taken by another, declined, note box open · **Deploy note:** none.

## Build

- A free person who let a transfer ring out, and is still free, has their
  switch turned off and sees "Missed a transfer · Taking calls off". Someone
  who started a call in those seconds keeps it on.
- Who was rung is known only to the call: keep it, so `/auto/after` can turn
  off exactly those people. (As built: the end's address names them.)
- The browser must learn that: its switch shows what the server holds (T10),
  and today it reads it only at sign-in and when switched. One way: the
  30-second report (T9) answers with the switch's state. The switch-off is a
  `calls.availability_changed` row with `why: missed_transfer`, written in the
  same statement. Noted 2026-10-18.

**Files:** `backend/src/core/call-script.ts` (+ test),
`backend/src/integrations/twilio.ts` (+ test), `backend/src/integrations/twilio-calls.ts`
(+ test), `backend/src/api/twilio-webhooks.ts`,
`backend/src/api/__tests__/auto-call-webhooks.test.ts`, `backend/src/db/presence.ts`,
`backend/src/db/users.ts`, `backend/src/db/migrations/017_taking_calls.sql`,
`backend/src/api/calls.ts`, `backend/src/api/auth/routes.ts`,
`backend/src/api/taking-calls.ts`, `backend/src/api/users/types.ts`, their tests,
`backend/scripts/presence-live-check.ts`, `frontend/src/lib/taking-calls.ts` (+ test),
`frontend/src/lib/calling.ts`, `frontend/src/api/calls.ts`, `frontend/src/api/types.ts`,
`frontend/src/layout/TakingCalls.tsx` (+ test), `frontend/src/styles/shell.css`.

## Done when

- [x] A live check: rung and still free -> off, recorded `missed_transfer` in
      the same statement, the system's doing; the report then answered with
      it; the same again changes nothing; on a call by then -> still on; a
      deactivated account -> nothing; the reason kept on every write
      (`presence-live-check`, 45 checks).
- [x] Tests: `rangOut` - alone and ran out, several with one declined, not
      known, taken, every ring declined, the lead hung up; the webhook - only
      whose own ring ran out, someone rung twice by their latest ring, the
      lead's own agent without asking Twilio, a decline, a hang-up, Twilio
      not answering, a forged list; reading the
      rings; the reason at sign-in, sign-out and by hand; the report's answer;
      the notice shown only for that reason and gone once switched on; a report
      that crossed a switch made here not taken (906 backend, 351 frontend
      tests).
- [x] Two browsers, a real call nobody takes: both switches off, both screens
      say so - 2026-10-20, calls 27, 28 and 38 (38 through Twilio's own record
      of each ring).
- [x] Someone else takes it -> nobody else's switch changes - call 37. (Call
      35, before the fix, switched the other person off: Twilio reports a ring
      cut short by another's answer as `no-answer`, like one that ran out.)
- [x] B not free -> B is not rung, and B's switch stays on - call 36: nora's
      note box was still open, so only Jeel was rung; nora's switch stayed on.
      A decline keeps it on too - call 34.

## Docs to update in the same commit

`AUTO-CALLS.md`, "Who is free" and "The transfer"; `SCHEMA.md`, `AUDIT.md`,
`AUTH.md`, `FRONTEND.md`, `LOGGING.md`, `README.md`, `CLAUDE.md`.

## As built

`AUTO-CALL-TRANSFER.md`, "Who is free", "Letting a transfer ring out turns it off". Two
changes from the plan. **Decided at the end of the whole ring, not from each
person's ring**: built first with a report per person's ring (`/auto/rang`),
it switched off a person whose ring was cut short by a colleague answering -
Twilio reports that exactly as a ring that ran out - so that webhook was
removed, and `/auto/after` decides, reading from Twilio how each ring ended
when several were rung. **Why the switch is as it is is stored**
(`users.taking_calls_why`, in migration 017 before release), so the screen
says "Missed a transfer" for that reason only, after a reload too, and never
for yesterday's. Every browser now learns the switch within half a minute,
not only the one rung.

**From the real transfers' notes** (moved here from `AUTO-CALLS.md` on 2026-11-27, "The transfer"):

- **Twilio reports every ring cut short as `no-answer`** (T15c, calls 33 and
  35): a ring that ran out and one stopped because someone else answered
  arrive identical, SIP 487 both - which is why who let it ring out is decided
  at the end of the whole ring ("Who is free").
- **Accepting with no microphone turns the ring down**: on a Mac mini with
  none, Accept showed an error and Twilio counted the ring `busy` - the
  transfer went on to the others, and that person's switch stayed on (call 34).
  A microphone plugged in afterwards is seen after a reload.

---

Design: `docs/AUTO-CALLS.md`, `docs/AUTO-CALL-SCRIPT.md`, `docs/AUTO-CALL-TRANSFER.md`. Tracker:
[`README.md`](README.md). One branch off `dev`, one PR into `dev`, with its code, tests and
doc lines.
