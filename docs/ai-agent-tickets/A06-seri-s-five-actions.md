# A06 · Seri's five actions

**Goal:** The five actions Seri can take are defined once, as OpenAI tools, and turned into what Twilio hands back.

**Why:** One place decides what each action means, so the relay and `/auto/ai-after` agree.

**Depends on:** A07  ·  **Size:** Small (a few hours)

## Build

- `backend/src/ai/actions.ts`: the tool definitions for `transfer_to_agent`, `book_callback` (time, time zone, reason), `send_link`, `opt_out`, `end_call` (reason).
- `toHandoff(toolCall, context)` validates the arguments and returns the `handoffData` object; bad arguments return an error for the AI to fix:
  - `book_callback`: the time through `checkCallbackTime` (A07). Outside the hours, in the past or too far ahead: the error names the nearest allowed time, so Seri offers it.
  - `transfer_to_agent` when the turn's context says **nobody at all** is there (`docs/AI-AGENT.md` section 3): an error telling Seri to offer a call back time instead.
- `fromHandoff(raw)` parses `HandoffData` from Twilio's post back, safely, for `/auto/ai-after`.
- A `fallback` handoff, used by the relay when OpenAI fails (A12).

## Done when

- [ ] Round trip: tool call to `handoffData` to `fromHandoff` gives the same action.
- [ ] Junk or missing `HandoffData` parses as `fallback`, never throws.
- [ ] A call back at 8 PM, and a transfer with nobody there, come back as errors that say what to offer.

## Tests

- Each action round trip; bad arguments; refused times; transfer with nobody there; junk input.

## Docs to update in the same commit

- `docs/AI-AGENT.md` section 3 table.

## Not in this ticket

- Carrying the actions out (A14).

Design: `docs/AI-AGENT.md`. All AI code in `backend/src/ai/`. One PR into `dev`.
