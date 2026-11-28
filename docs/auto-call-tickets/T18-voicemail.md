# T18 · Voicemail

**Goal:** a voicemail gets the message after the beep, and a machine is never
transferred.

**Depends on:** T12 · **Size:** - · **Status:** Done 2026-10-24 - real calls: a real
voicemail, the whole message; a beep while the call spoke, and while a transfer rang ·
**Deploy note:** none.

## Build

- `POST .../auto/amd` - Twilio's verdict on who answered (the webhook exists
  since T12 and keeps the verdict). A machine, once its greeting ends -> the
  call switches to the voicemail message (the number read out digit by
  digit), then hangs up; result `voicemail_left`.
- A fax -> hang up. A person, or not sure -> the script carries on.
- The verdict is saved as `answered_by`, as for agents' calls.
- A verdict that arrives while a transfer is ringing stops it and leaves the
  message.
- **A late "machine" is not trusted once the lead has answered** - found on a
  real transfer, 2026-10-20 (call 24): the verdict said machine after the lead
  had said "Yes." at 0.89 and was being put through. Acting on it would have
  hung up on a person who said yes. Once a call has a kept answer - a choice,
  or a key - a "machine" verdict changes nothing: no message, no stopped
  transfer, and the outcome stays `answered`, not `voicemail` (T12 saved
  `voicemail` for any answered call a machine picked up). Noted 2026-10-20.
  *(Superseded while building: for a choice, the beep decides - "As built"
  below; a key still always means a person.)*

**Files:** `backend/src/core/call-script.ts` (+ test), `backend/src/db/auto-calls.ts`,
`backend/src/db/calls.ts`, `backend/src/core/calls.ts` (+ test), `backend/src/integrations/twilio.ts` (+ test),
`backend/src/integrations/twilio-calls.ts` (+ test), `backend/src/api/twilio-webhooks.ts`,
`backend/src/api/__tests__/auto-call-webhooks.test.ts`,
`backend/scripts/auto-calls-live-check.ts`, `backend/scripts/calls-live-check.ts`.

## Done when

- [x] A real call to Jeel's voicemail: the whole message is recorded after
      the beep; "Voicemail left" is saved - 2026-10-24, calls 58 and 59: the
      beep heard 9.3 seconds into listening, the message whole from its first
      word, the number transcribed "480-530-8582".
- [x] Route tests: machine, fax, person, not sure; "machine" after the lead
      has answered -> ignored. And: `machineVerdict` and every branch of
      `onVerdict` - a beep after an answer, a key or a transfer taken, the
      script over; the message's words, the number digit by digit; the
      webhook - the TwiML, the fax, a repeat, the database failing after
      Twilio's answer, no script, not this call; an answer and a ring's end
      after a takeover changing nothing, and logged as nothing else;
      `replaceCall` - a refusal, and no answer in time counted as taken
      (985 backend tests).
      `tookByMachine` (`core/calls.ts`), which the transfer's check used, is
      gone with it.
- [x] A live check proves the SQL: each branch on a real row, Twilio
      refusing saves nothing, an answer arriving during the takeover waits
      and is not kept, two verdicts at once take over once, a fax `unanswered`,
      a ring from hold cut short ended `failed` (`auto-calls-live-check`, 117
      checks); an automated call `voicemail`
      only when taken over (`calls-live-check`, 105).
- [x] A beep while a transfer rang - sent by hand, signed as Twilio signs:
      the ring stopped, the message played, and nobody was switched off, though
      Twilio reported the ring `no-answer` - call 62.

## Docs to update in the same commit

`AUTO-CALLS.md`, "Voicemail"; `TWILIO.md`, `SCHEMA.md`, `AUDIT.md`,
`LOGGING.md`, `README.md`, `CLAUDE.md`.

## As built

`AUTO-CALL-SCRIPT.md`, "Voicemail". **The beep decides** - found while building, from the
43 real calls' verdicts and the script's words, and agreed with Jeel on
2026-10-23: the ticket's rule, any answer means a person, would have left no
message on a voicemail whose greeting says "no one is available" - heard as
"No". A beep after an answer is the greeting talking; a machine with no beep
after an answer is call 24. Three things beyond the ticket. **Twilio sends the
replaced page's request after a takeover** - the question's, with the
greeting's words, and a ring's end reported `no-answer` - so both are ignored
once the message has the call; the second would have switched an agent off.
**A transfer no longer checks for a machine itself**: a verdict that was
ignored is a person's, whose yes must ring. And **a second's quiet after the
message**: the first one's transcript ended "Thanks and have a".

Found by an independent read of the docs against the code, after merging,
and fixed the same day: a ring from hold the message cut short stayed open a
minute - now ended with the takeover; Twilio not answering the takeover in
time counted as a refusal, so a message could play unsaved - now only
Twilio's own refusal does; and a request after a takeover could still be
logged as an answer or a transfer - now only as `after_takeover`. A greeting
heard as a "yes", with no beep reported, is put through - `AUTO-CALL-SCRIPT.md`, "Not done".

**Twilio's verdicts on real calls** (moved here from `AUTO-CALLS.md` on 2026-11-27, "Voicemail"): on the 43
real calls to a person, 2026-10-18 to 10-22, Twilio said `unknown` 37 times and
`human` 5 times, after 3.4 to 6.6 seconds of listening - and once, call 24,
`machine_end_other` after its full 30 seconds: a person who had said "Yes." and
was being put through.

**The real calls** (2026-10-23 and 24, Jeel's phone, the dev number):

- **Declining, twice** (calls 56, 57): Jeel's carrier answered `busy` -
  never the voicemail; saved `busy`, `unanswered`, nothing said. To reach a
  voicemail, the phone is left to ring.
- **A real voicemail** (call 58): it picked up after 20 seconds; Twilio heard
  the beep 9.3 seconds into listening (`machine_end_beep`); the message was
  recorded whole, from "Hi, this is Seri" - nothing before it - the number
  transcribed "480-530-8582"; `voicemail`, `voicemail_left`. Its transcript
  ended "Thanks and have a", hence the second's quiet; call 59, with it, was
  whole to the end.
- **A beep while the call spoke** (calls 60, 61): the "connecting you" line
  and the recording notice cut off mid-sentence, the message instead. The
  beep was sent by hand - signed as Twilio signs, Twilio's own `unknown`
  verdict cleared first in the local database - since a phone that says yes
  cannot also beep.
- **A beep while nora's window rang** (call 62): the ring began 14 seconds
  after the yes - the line and the notice take that long - and stopped 4
  seconds later at the beep; the message played; nora's window cleared with
  no notice, and nora's switch stayed on, though Twilio reported the ring
  `no-answer`.

---

Design: `docs/AUTO-CALLS.md`, `docs/AUTO-CALL-SCRIPT.md`, `docs/AUTO-CALL-TRANSFER.md`. Tracker:
[`README.md`](README.md). One branch off `dev`, one PR into `dev`, with its code, tests and
doc lines.
