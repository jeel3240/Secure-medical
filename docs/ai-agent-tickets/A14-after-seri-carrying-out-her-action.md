# A14 · After Seri: carrying out her action

**Goal:** `/auto/ai-after` turns Seri's action into today's transfer, link, opt-out or goodbye, and falls back to the script when she failed.

**Why:** All the hard call logic already exists; this connects Seri to it.

**Depends on:** A06, A13  ·  **Size:** Medium (about a day)  ·  **Status:** Done 2026-11-12

## Build

- New route `/auto/ai-after`, like every `/auto/*` route: signed, archived in `webhook_events`, 404 while automated calls are off. Reads `SessionStatus` and `HandoffData` (`fromHandoff`).
- **Seri has already said her last line, in her voice** (`docs/AI-AGENT.md` section 3), so this route says none of the script's lines for her:
  - `transfer_to_agent`: the recording notice, then `planTransfer` exactly as `/auto/gather` does (own agent first, everyone free, hold line, busy line). Not "Great, connecting you...".
  - `send_link`: `sendCallLinkText`, result `link_sent`, hang up.
  - `opt_out`: block the number, result `opted_out`, hang up.
  - `end_call`: result `not_interested`, hang up.
  - `book_callback`: hand to A15; result `callback_booked`, hang up.
- `fallback`, or `SessionStatus=failed`: "Sorry about that." then the script's **Q1 question only** - not its greeting, since Seri has introduced herself (`splitForListening`) - continuing as today.
- `completed` (lead hung up): result `hung_up` as today.
- Pull the shared parts of `/auto/gather` into functions both routes use; do not copy them.

## Done when

- [x] Each action gives the same calls, rows and texts as the same outcome on today's script - the same transfer code, the same result saved once, the same block, the link texted once.
- [x] No action's TwiML says a script line Seri already said - checked on every route test.
- [x] Every existing `/auto/*` test still passes - 99, with `/auto/gather`'s transfer moved into shared functions.

## Tests

- Route tests for each action, fallback, failed, hung up.

## Docs to update in the same commit

- `docs/AI-AGENT.md` section 3.

## Where it hooks in (from A12)

- `end_call` also comes from the relay itself, with reasons Seri is never offered (`RELAY_END_REASONS`, `ai/actions.ts`): `no_response` - the lead silent after "are you still there?", which reads as today's `no_response` - and `time_limit` - the three minutes ran out. Seri's own goodbye has been said either way.
- `fallback` comes with why: `model_failed`, `model_slow`, `socket_error`, `relay_failed`. The relay has already recorded it (`ai_ended_with`, `ai_agent.ended`); `endAiCall` records once, so calling it again changes nothing.
- `SessionStatus=failed` with nothing recorded - Twilio's side failing, or the relay never starting her - should record `fallback` here (`endAiCall`), so the robot counts every one (A17). `ai_ended_with` stays empty for a call she never started.

## Where it hooks in (from A13)

- The address is already in every call's TwiML: `AUTO_AI_AFTER_PATH` (`integrations/twilio.ts`), `/api/webhooks/twilio/auto/ai-after?call=<row>`, POST - the row in the query, as every `/auto/*` webhook has it, so `automatedCall(req)` finds it. Under `/auto/`, so the router's guard (404 with automated calls off, signature, archive) already covers it.
- `/auto/answer` loaded the script before connecting her; a fallback loads it again here (`loadScript`) - it may have changed in three minutes, and today's script is read per request anyway.

## Not in this ticket

- Saving the callback itself (A15).

## As built

- **One pure rule**, `afterSeri` in `backend/src/ai/after.ts`: her action, with the lead on the line or gone, becomes a transfer, the script, or an end with its result, a block, the link, or a call back to save. `fallbackAsk`: "Sorry about that." (`FALLBACK_LINE`) and the first step's question alone.
- **The route reads which action from `SessionStatus`:** `ended` - `HandoffData`; `failed` - what the relay had recorded, else a fallback recorded here as `twilio_failed`; `completed` - what the relay had recorded (`recordedHandoff`, `ai/relay-store.ts`, her last `action` turn), since Twilio sends no `HandoffData` on a hang-up. Beyond the ticket: a hang-up after her action still carries out what needs no line - a stop blocks, the link is texted, as said while hanging up on the script.
- **Shared, not copied:** `/auto/gather`'s transfer became `planYes` and `yesTwiml` in the router, used by both; `keepAnswer`'s transaction became `inCallLock` and `saveOutcome` in `db/auto-calls.ts`, used by it and by `keepCallResult`, which saves her result once and a stop's block, with no answer row.
- **`end_call` results:** `not_interested` for every reason she gives and for the time limit; `no_response` only for the relay's silence, and none (`hung_up`) when the lead hung up.
- **The ring of her transfer** reads "Transfer · said yes to the offer" - the script's first step's heading, also given by `transferContext` for a call she took, so a ring from hold reads the same. A19 left it as it is; A21 hears it on a real ring.
- **After the voicemail's takeover** nothing is done and `auto_call.after_takeover` is logged - one of A18's points, built here since the check is the same as `/auto/after`'s.
- **`CallResult`** (`core/call-script.ts`) gained `callback_booked`, which migration 022 already allowed.
- **Tests:** 17 for the rule, 23 for the route, 14 live checks (86 in `ai-agent-live-check`); 1,595 backend tests; all 23 live checks.
- **Seen on the real API** (a scratch database, a pretend Twilio through the relay): a stop, a stop then a hang-up, OpenAI refusing the key, a transfer - each carried out and recorded as above.
- **Not covered:** a lead who says stop and hangs up before Twilio passes the words to the relay - nothing blocks the number. For A21.

Design: `docs/AI-AGENT.md`. All AI code in `backend/src/ai/`. One PR into `dev`.
