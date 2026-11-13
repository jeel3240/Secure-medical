# A14 · After Seri: carrying out her action

**Goal:** `/auto/ai-after` turns Seri's action into today's transfer, link, opt-out or goodbye, and falls back to the script when she failed.

**Why:** All the hard call logic already exists; this connects Seri to it.

**Depends on:** A06, A13  ·  **Size:** Medium (about a day)

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

- [ ] Each action gives the same calls, rows and texts as the same outcome on today's script.
- [ ] No action's TwiML says a script line Seri already said.
- [ ] Every existing `/auto/*` test still passes.

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

Design: `docs/AI-AGENT.md`. All AI code in `backend/src/ai/`. One PR into `dev`.
