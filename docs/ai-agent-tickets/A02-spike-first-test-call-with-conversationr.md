# A02 · Spike: first test call with ConversationRelay

**Goal:** Prove ConversationRelay works on our setup before building on it, and let Jeel pick Seri's voice.

**Why:** If the WebSocket does not pass through Caddy, or the voice or speed is bad, or Twilio cuts Seri's last line short, we find out now, not after A10-A14.

**Depends on:** A01  ·  **Size:** Small (a few hours)

## Before the call

- The Twilio account has completed ConversationRelay's onboarding in the console, including accepting Twilio's AI features addendum (`docs/AI-AGENT.md` section 1). Without it the call fails.
- The local `.env` holds only the dev number and dev TwiML App (`docs/TWILIO.md`), and a tunnel is set as `PUBLIC_URL`.

## Build

- A temporary dev-only route that answers the **dev number** (480) 530-8582 with `<Connect><ConversationRelay>`: `ttsProvider="ElevenLabs"`, `transcriptionProvider="Deepgram"`, `interruptible="speech"`, `welcomeGreeting`, `dtmfDetection="true"`, `events="speaker-events"`, and a `<Parameter>`.
- A temporary WebSocket at `/api/ai/spike` that says back what it heard ("You said: ...").
- Two or three ElevenLabs voices, switched by a query parameter, so Jeel can hear each.
- Log, per turn: time from the caller stopping to Seri starting (`last` prompt to first audio).
- Run once through a tunnel locally, and once on a throwaway server path if needed, to check Caddy passes `wss` on `/api/*`.

## Done when

- [ ] Jeel has called it and **picked a voice**. The voice id is written in `docs/AI-AGENT.md` section 1.
- [ ] Talking over Seri stops her (`interrupt` message received).
- [ ] Timing measured and written in `docs/AI-AGENT.md`: typical and slowest turn.
- [ ] Confirmed: WebSocket works through Caddy (or the change Caddy needs is written down).
- [ ] Confirmed and written down: the WebSocket request carries `X-Twilio-Signature`, and what URL it is signed for (A10 checks it).
- [ ] Confirmed and written down: the shape of the `agentSpeaking` messages, and whether a `<Parameter>` arrives in `setup`.
- [ ] Confirmed and written down: **does `end` straight after a `text` cut the line short?** Say a long line, then `end`; then the same waiting for `agentSpeaking` off. The relay (A11) is built on the answer.
- [ ] Confirmed: a key press arrives as a `dtmf` message.
- [ ] The spike route and WebSocket are **removed** before merging, or never merged: only the findings are kept.

## Tests

- None automated: this is a measurement.

## Docs to update in the same commit

- `docs/AI-AGENT.md`: voice id, timings, Caddy finding, and the four confirmations above.

## Not in this ticket

- OpenAI. The echo is enough to test voice, listening and speed of the Twilio side.

Design: `docs/AI-AGENT.md`. All AI code in `backend/src/ai/`. One PR into `dev`.
