# A06 · Seri's five actions

**Goal:** The five actions Seri can take are defined once, as OpenAI tools, and turned into what Twilio hands back.

**Why:** One place decides what each action means, so the relay and `/auto/ai-after` agree.

**Depends on:** A07  ·  **Size:** Small (a few hours)  ·  **Status:** Done 2026-11-11

## Build

- `backend/src/ai/actions.ts`: the tool definitions for `transfer_to_agent`, `book_callback` (time, time zone, reason), `send_link`, `opt_out`, `end_call` (reason).
- `toHandoff(toolCall, context)` validates the arguments and returns the `handoffData` object; bad arguments return an error for the AI to fix:
  - `book_callback`: the time through `checkCallbackTime` (A07). Outside the hours, in the past or too far ahead: the error names the nearest allowed time, so Seri offers it.
  - `transfer_to_agent` when the turn's context says **nobody at all** is there (`docs/AI-AGENT.md` section 3): an error telling Seri to offer a call back time instead.
- `fromHandoff(raw)` parses `HandoffData` from Twilio's post back, safely, for `/auto/ai-after`.
- A `fallback` handoff, used by the relay when OpenAI fails (A12).

**Changed after A21's call 92 (2026-11-13):** `book_callback` is refused unless her reply the lead has just answered named the time - she said it back and they agreed (`NOT_AGREED`; the context gains `before`); and the refused transfer with nobody there now says to ask when, not to book. `docs/AI-AGENT.md` section 4.

## Done when

- [x] Round trip: tool call to `handoffData` to `fromHandoff` gives the same action - each of the five, every `end_call` reason, and the relay's `fallback`.
- [x] Junk or missing `HandoffData` parses as `fallback`, never throws - 15 kinds, from nothing at all to a call back with a made-up zone.
- [x] A call back at 8 PM, and a transfer with nobody there, come back as errors that say what to offer - "Not booked. That is outside the agent hours. Offer tomorrow at 1 PM your time instead, and if they agree, book it as 2026-11-12T13:00."; and "Nobody can take a call right now, so do not transfer. ... book it with book_callback."

## Tests

- Each action round trip; bad arguments; refused times; transfer with nobody there; junk input. `src/ai/actions.test.ts`, 45 tests: also the tools' schemas, past, too soon, too far, a weekend, Arizona's own time, no hours at all, an action that does not exist, unreadable arguments, extra fields dropped. 1,384 backend tests in all.

## Docs to update in the same commit

- `docs/AI-AGENT.md` section 3 table.

## Not in this ticket

- Carrying the actions out (A14).

## As built

- **`ACTION_TOOLS`** are Chat Completions function tools (`openai/resources/chat/completions`), **strict**: every argument required, nothing else allowed, so OpenAI's arguments always match. `transfer_to_agent`, `send_link` and `opt_out` take none; `book_callback` takes `time` ("2026-11-12T15:00", on the lead's own clock), `time_zone` (IANA) and `reason` (one line, at most 200 characters); `end_call` takes `reason`, one of `not_interested`, `wrong_person`, `emergency`, `other` - a list, not free text, so the reasons can be counted. Each tool's description repeats when to use it and the last line to say first.
- **`toHandoff(toolCall, { whoIsThere, hours, now })`** returns `{ ok: true, handoff }` or `{ ok: false, error }`; the error is written to Seri, as the tool's result, so she puts it right and the call goes on. A refused call back names why (past, too soon, too far, outside the hours) and the time to offer, said as she would say it and as she would book it - "Offer tomorrow at 1 PM your time instead, and if they agree, book it as 2026-11-12T13:00." - with the link in its place when the settings allow no time at all. The lead's zone is the one she gives: a lead who says they are in California is booked in California's time.
- **The handoff** is JSON: `{ "action": "book_callback", "at": "<ISO instant>", "timeZone": "America/New_York", "reason": "..." }`, `{ "action": "end_call", "reason": "not_interested" }`, `{ "action": "fallback", "why": "..." }`, or the action alone. `handoffData` writes it; `fromHandoff` reads Twilio's `HandoffData` back, keeps only the fields it knows, and turns anything else into a `fallback` - `no_handoff`, `unreadable_handoff`, `unknown_action` - never a throw.
- **A refused call back after Seri said goodbye** - her instructions have her confirm and say goodbye before booking - is put right in the same call: the error tells her what to offer, and she offers it. Rare, since her instructions give her the agent hours in the lead's own time.
- `toLocalTime` was added to `callback-time.ts` (A07): an instant written back as a wall clock in a zone, for the time to book.

- **Changed by A09 (the answer test set), 2026-11-11:** `ActionContext` gains `said`, what she said before the action, and an action after a reply that ended on a question is refused with `awaitLead` - nothing more is said, and the call goes on with the lead's answer. `lineToAdd` and `lastLine` give the line the relay says after hers: the action's own when she said none, the stop line after an opt-out without it.

Design: `docs/AI-AGENT.md`. All AI code in `backend/src/ai/`. One PR into `dev`.
