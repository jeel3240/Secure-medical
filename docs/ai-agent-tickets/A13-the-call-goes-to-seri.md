# A13 · The call goes to Seri

**Goal:** With the switch on, an answered automated call connects to Seri instead of the script.

**Why:** The switch that changes every call.

**Depends on:** A01, A10  ·  **Size:** Small (a few hours)

## Build

- `/auto/answer` in `backend/src/api/twilio-webhooks.ts`: when `readAiAgentOn` (A01) says on, reply with `<Connect action="/api/webhooks/twilio/auto/ai-after?call=...">` and `<ConversationRelay>`: the voice from A02, Deepgram, `interruptible="speech"`, `dtmfDetection="true"`, `events="speaker-events"`, the opening as `welcomeGreeting` ("Hi, is this John?", or "Hi there"), the relay URL, and `<Parameter name="call">` with the row id. Off: exactly today's `firstAsk`.
- TwiML built in `backend/src/integrations/twilio.ts` next to `autoCallTwiml`.
- Machine detection unchanged.

## Done when

- [ ] Off: every existing `/auto/answer` test passes unchanged.
- [ ] On: the TwiML has the right voice, greeting, action URL, relay URL and call parameter.
- [ ] On without `OPENAI_API_KEY`: today's script, and `ai_agent.no_key` logged once.

## Tests

- TwiML snapshot; on, off, on without a key.

## Docs to update in the same commit

- `docs/AI-AGENT.md` section 2; `docs/AUTO-CALLS.md` one line pointing to it.

## Not in this ticket

- Carrying out the action (A14).

Design: `docs/AI-AGENT.md`. All AI code in `backend/src/ai/`. One PR into `dev`.
