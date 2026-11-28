# T19 · A lead calling back reaches someone

**Goal:** a lead who calls (480) 470-8259 back reaches a person, even when no
agent owns them.

**Depends on:** T10, T11 · **Size:** - · **Status:** Done 2026-10-24 - real calls
back: everyone free rang, one took it; nobody took it, missed and texted · **Deploy
note:** none until `AUTO_CALLS` is on.

## Build

- Who rings for an incoming call: the lead's holder -> the last agent who
  called them (a robot call an agent took counts) -> **everyone free**
  (`ring=group`) -> nobody, missed call as today.
- A group ring's end is taken from the call itself, never from one person's
  ring stopping, so the lead is not sent the missed-call text while someone
  is talking to them.
- Only with `AUTO_CALLS` on; off, it works exactly as today.
- Decide the incoming card's "Calling back" line for a lead returning the
  automated call - T5 counts only agents' calls there, so today it says
  nothing; "Calling back · automated call, 2h ago" is one way. Noted 2026-10-18.

**Files:** `backend/src/db/calls.ts`, `backend/src/core/activity.ts`,
`backend/src/integrations/twilio.ts`, `backend/src/api/twilio-webhooks.ts`,
`backend/src/api/__tests__/calls.test.ts`, `backend/scripts/calls-live-check.ts`,
`frontend/src/lib/caller-context.ts` (+ test).

## Done when

- [x] A live check: holder; last caller; everyone free; nobody free -> missed.
      And: not the switch off, not someone on a call; nobody's while it rings,
      recorded as a ring to everyone; a retried webhook one call; taken by the
      first to accept, once, recorded `call.taken`; a second accept, an
      account deactivated, a call over refused; answered and his, or missed
      and nobody's, with no callback booked; the lead's own agent still rung
      alone; automated calls off, missed as before; the lead taken over from
      someone whose browser picked it up first; Twilio asking again - the
      taker alone, a call over not rung, nobody free now missed and texted
      (`calls-live-check`, 133).
- [x] A real call back after T18's voicemail rings the free browsers -
      2026-10-24, call 63: Jeel's phone called the dev number, both windows
      rang; nora accepted and took the call and the lead; Jeel's ring,
      reported `no-answer` the same instant, was ignored; answered, 10
      seconds, recorded.
- [x] Nobody takes it - call 64: rung, then missed, nobody's; the lead heard
      that we would call back and got the missed-call text; nobody's switch
      changed. It rang one person: nora's note box from call 63 was still
      open, so nora was not free. Its card read "Calling back · automated
      call, 28m ago" - the robot's call 62, 27 minutes 44 seconds before.
- [x] With `AUTO_CALLS` off, the existing incoming-call tests pass - one
      expectation names the new argument, `ringFree: false`. Route tests for
      the group ring: who is rung and how it is marked, taking it, refusals,
      unsigned and off, the whole ring's end - taken, run out, the lead
      hanging up while it rang - and no browser reporting its own (997
      backend tests); the card's line (352 frontend tests).

## Docs to update in the same commit

`TWILIO.md`, "Who rings"; `AUTO-CALLS.md`; `SCHEMA.md`, `AUDIT.md`,
`LOGGING.md`, `FRONTEND.md`, `README.md`, `CLAUDE.md`.

## As built

`INCOMING-CALLS.md`, "Who rings" (then in `TWILIO.md`), and `AUTO-CALL-TRANSFER.md`, "A lead
calling back". One addition
to the ticket: **taking the call is its own webhook**, `/incoming/claim`, run
on the leg of whoever accepts - the row's `agent_id` is null while everyone
rings, and must name a person the moment one is on the call, for "on a call"
(`FREE_SQL`) and for the call to be theirs. A new action, `call.taken`. The
card's line was decided as the ticket suggested. Letting a call-back ring run
out turns no switch off - only a transfer does (T15c).

Found by an independent read of the docs against the code, after merging,
and fixed the same day: **a refused second accept could end the call** - built
first with each browser reporting its own end and only an answered one
counting, a second accept, answered and then hung up, reports `completed`
like the call itself - so no browser reports its end now, and the whole ring's
end decides; **the lead could stay with the person refused**, whose browser
picked it up first - the lead now follows the call, as a transfer's does; and
**Twilio asking again could decide differently** - ring people for a call
already missed, or leave a call open with nothing ringing - now the first
decision holds.

---

Design: `docs/AUTO-CALLS.md`, `docs/AUTO-CALL-SCRIPT.md`, `docs/AUTO-CALL-TRANSFER.md`. Tracker:
[`README.md`](README.md). One branch off `dev`, one PR into `dev`, with its code, tests and
doc lines.
