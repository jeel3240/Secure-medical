# T12 · The server places one call

**Goal:** the server can call a phone, say question 1, and save how the call
ended.

**Depends on:** T3, T4, T6 · **Size:** - · **Status:** Done 2026-10-18 - a real call
to Jeel's phone; the opening and voice changed after it (018) · **Deploy note:** none.

## Build

- `integrations/twilio-calls.ts` - the only file that places calls through
  Twilio's REST API, with voicemail detection switched on (for T18) and a
  time limit on the request.
- `npm run dev:auto-call -- <phone>` places one call to a lead with that
  number. It refuses in production.
- **Outside production, only numbers in `AUTO_CALL_TEST_NUMBERS` are ever
  called** - by this command and later by the robot.
- Placing a call: lock the lead, check it is not blocked, save the `calls`
  row (`automated`) and `call.started` in one transaction, then ask Twilio.
  Twilio refuses -> saved as `failed`. No answer from Twilio in time -> left
  as it is (the call may have gone out).
- `POST /api/webhooks/twilio/auto/answer` - says question 1 and listens (keys
  and speech). Fills in Twilio's call id if it was not saved.
- `POST /api/webhooks/twilio/auto/status` - saves the end: outcome, length,
  end time, `call.ended`.
- Both routes: refused without Twilio's signature (403), not found with
  calling off (404), kept in `webhook_events`.

**Files:** `backend/src/integrations/twilio-calls.ts` (+ test),
`backend/src/integrations/twilio.ts` (the TwiML, + test), `backend/src/api/twilio-webhooks.ts`,
`backend/src/api/__tests__/auto-call-webhooks.test.ts`, `backend/src/db/auto-calls.ts`,
`backend/src/worker/place-auto-call.ts` (+ test), `backend/src/auto-calls-settings.ts`
(+ test), `backend/src/core/call-script.ts`, `backend/scripts/dev-auto-call.ts`,
`backend/scripts/dev-phone.ts`, `backend/scripts/auto-calls-live-check.ts`,
`backend/package.json`, `docker-compose.yml`, `.env.example`; and for the
opening and the voice, `backend/src/db/migrations/018_call_opening_and_voice.sql`,
`backend/src/core/call-script-fixtures.ts`, `backend/scripts/call-script-live-check.ts`.

## Done when

- [x] Route tests: signed, unsigned, signed for another row, calling off,
      automated calls off, the end saved, the verdict kept, a request naming
      no row or another call's - 17 tests.
- [x] Jeel's phone rings showing the new number and hears question 1 -
      2026-10-18, call 4, placed from (480) 530-8582 with `dev:auto-call`.
- [x] The row is saved with its outcome and length - answered, 13 seconds, no
      agent; the four webhooks arrived in order (answer, amd, gather, status)
      and the activity log has `call.started`, `call.answered_by` and
      `call.ended`, all the system's.
- [x] A number not on the list is refused - tested, and proved on a real
      database with every other refusal, linking, failing and two placements
      racing for one lead (`auto-calls-live-check`, 34 checks).

## Docs to update in the same commit

`AUTO-CALLS.md`, "How a call is placed"; `TWILIO.md`, `AUDIT.md`,
`LOGGING.md`, `README.md`, `CLAUDE.md`.

## As built

`AUTO-CALLS.md`, "How a call is placed". The steps are one path,
`worker/place-auto-call.ts`, which the dialler uses too (T20). The webhooks name
our row (`?call=<id>`), not Twilio's call, because the row exists before
Twilio answers. The voicemail verdict already has its webhook,
`/auto/amd`, which keeps it as for an agent's call; T18 adds the message. Until
T13, `/auto/gather` thanks the lead and ends the call, whatever was said -
without it, the first answer would reach no webhook and the lead would hear
Twilio's error. All four answer 404 while `AUTO_CALLS` is off, so production
has none of them until it is switched on.

The first real call taught three things. **Twilio still asks `/auto/gather`
after the lead hangs up**, with `CallStatus=completed` and nothing heard - T13
must take that as hung up, never as silence to ask again. **Voicemail
detection said `unknown` for a person** who listened - T18 carries on for
`unknown`, as planned. And Jeel asked for **no "This is an automated call"
line, the offer before the question, and a more natural voice**: migration
018, after a sample call of five newer voices - `AUTO-CALL-SCRIPT.md`, "The script". Each of its changes names the value it
replaces and must change exactly the rows it expects, or the migration stops.
(T13 then added the stop and repeat lines to 018: four guarded changes in all,
over three of 015's rows.)

---

Design: `docs/AUTO-CALLS.md`, `docs/AUTO-CALL-SCRIPT.md`, `docs/AUTO-CALL-TRANSFER.md`. Tracker:
[`README.md`](README.md). One branch off `dev`, one PR into `dev`, with its code, tests and
doc lines.
