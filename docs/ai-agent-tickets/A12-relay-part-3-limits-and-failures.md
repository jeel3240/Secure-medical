# A12 · Relay part 3: limits and failures

**Goal:** Seri handles silence, the 3-minute limit and a slow or failing OpenAI without leaving the lead stuck.

**Why:** One bad call must never break a call.

**Depends on:** A11  ·  **Size:** Medium (about a day)  ·  **Status:** Done 2026-11-12

## Build

- Silence: 6 seconds counted from when Twilio says Seri stopped talking (`agentSpeaking` off). "Hello, are you still there?"; silent again: a goodbye, then `end_call`.
- 3 minutes: one message to the AI to wrap up (offer a person or the link once); if it does not finish within 20 seconds, `end_call`.
- No first word from OpenAI in 4 seconds: send "One moment..."; still nothing after 4 more: `end` with `fallback`.
- OpenAI error or socket error: `end` with `fallback`.
- Every fallback saved as `calls.ai_ended_with = 'fallback'`, which A17 counts.

## Done when

- [x] Each case tested with a fake clock and a fake OpenAI that is slow, errors, or never answers - `conversation.test.ts` (21 new) and `relay.test.ts` (6 new, over a real WebSocket).

## Tests

- WebSocket tests.

## Docs to update in the same commit

- `docs/AI-AGENT.md` section 6.

## Where it hooks in (from A11)

- `ai/conversation.ts`, `respond()`: an OpenAI failure is caught and logged (`ai_relay.model_failed`) and nothing more is said - the fallback goes there. Each reply already records when OpenAI's first word arrived (`firstWordAt`) - the 4-second wait starts from the same `heardAt`.
- Speaker events already arrive parsed (`relay-messages.ts`, `type: 'speaking'`) and are not used yet - the silence count starts from `agentSpeaking` off.
- A fallback ends like an action: `endMessage(fallbackHandoff(why))`, and `endAiCall` records it.

## Not in this ticket

- What `fallback` does on the call (A14).

Design: `docs/AI-AGENT.md`. All AI code in `backend/src/ai/`. One PR into `dev`.

## As built

`backend/src/ai/conversation.ts`, beside her replies; `docs/AI-AGENT.md` section 6, "As built (A12)", has the whole of it.

- **The clocks** start when `setup` has started her on the call (`conversation.start()`, from the relay) and stop when her part ends or the socket closes. They run on `timers`, so the tests move a clock by hand (`ai/fake-clock.ts`); the limits are one constant, `LIMITS`.
- **Silence:** Twilio's speaker events reach the conversation (`speaking`). Counted while nobody talks and she is not answering - from `agentSpeaking` off, from the end of her reply if that came first, from `clientSpeaking` off with no words after it, and again after a key. The line and the goodbye are the relay's own, said in her voice and kept as hers; the end is `end_call` with a reason she is never offered, `no_response`.
- **Three minutes:** the note (`WRAP_UP_NOTE`) goes with her next reply, not on its own at the mark - the lead may be about to answer her then. After 20 seconds a reply she has started is said whole - OpenAI has 10 seconds more at most to write it (`lastReplyMs`) - then the goodbye and `end_call` with `time_limit`; if OpenAI has not started one, at once.
- **OpenAI slow:** timed per reply, so a refused action's second try has its own 4 seconds. The filler opens her utterance and is kept as her turn, not in what OpenAI reads.
- **Failing:** `fail(why)` - `model_failed`, `model_slow`, `socket_error`, `relay_failed` - closes what she was saying and ends with `fallback`. Before `setup` has started her, the relay closes the socket as before.

Beyond the ticket:

- **Two end reasons only the relay uses**, `RELAY_END_REASONS` in `actions.ts`: not in the tool OpenAI is offered, read back by `fromHandoff`, with their own last lines.
- **`why` kept with a fallback** in `ai_agent.ended`, and `reason` in `ai_relay.ended`; `ai_relay.closed` says whether her part had ended.
- **OpenAI's error is never quoted in the logs:** a refused key comes back in its message, partly hidden. `plainError` (`openai.ts`) keeps the status and code only.
- **The note's wording was tried on the real model** before it was kept: the first one let her text the link without asking, once in nine. As built, nine of nine asked first.

**Verified:** 1,546 backend tests; `ai-agent-live-check` 67 (a fallback, and silence's ending, recorded with their reasons); every live check; lint, build, `docker compose build api worker`. On the real API with a fake Twilio client: the check-in at 6.00 s and the goodbye 6.00 s later; with OpenAI never answering, the filler at 4.00 s and the fallback at 8.01 s; with OpenAI refusing a key, the fallback at 0.56 s - each recorded on the call.

**Not covered:** a stream that stalls after its first word - only the time limit ends it, three and a half minutes in at the latest; a reply with nothing in it (the silence then asks). A session that closes with no end of ours is the action URL's to record (A14, A18).
