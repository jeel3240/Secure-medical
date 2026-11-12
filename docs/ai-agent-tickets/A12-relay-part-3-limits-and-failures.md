# A12 · Relay part 3: limits and failures

**Goal:** Seri handles silence, the 3-minute limit and a slow or failing OpenAI without leaving the lead stuck.

**Why:** One bad call must never break a call.

**Depends on:** A11  ·  **Size:** Medium (about a day)

## Build

- Silence: 6 seconds counted from when Twilio says Seri stopped talking (`agentSpeaking` off). "Hello, are you still there?"; silent again: a goodbye, then `end_call`.
- 3 minutes: one message to the AI to wrap up (offer a person or the link once); if it does not finish within 20 seconds, `end_call`.
- No first word from OpenAI in 4 seconds: send "One moment..."; still nothing after 4 more: `end` with `fallback`.
- OpenAI error or socket error: `end` with `fallback`.
- Every fallback saved as `calls.ai_ended_with = 'fallback'`, which A17 counts.

## Done when

- [ ] Each case tested with a fake clock and a fake OpenAI that is slow, errors, or never answers.

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
