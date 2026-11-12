# A02 · Spike: first test call with ConversationRelay

**Goal:** Prove ConversationRelay works on our setup before building on it, and let Jeel pick Seri's voice.

**Why:** If the WebSocket does not pass through Caddy, or the voice or speed is bad, or Twilio cuts Seri's last line short, we find out now, not after A10-A14.

**Depends on:** A01  ·  **Size:** Small (a few hours)  ·  **Status:** Done 2026-11-12

## Before the call

- The Twilio account has completed ConversationRelay's onboarding in the console, including accepting Twilio's AI features addendum (`docs/AI-AGENT.md` section 1). Without it the call fails. Only the account owner can accept it: asked 2026-11-11, waiting.
- The local `.env` holds only the dev number and dev TwiML App (`docs/TWILIO.md`), and a tunnel is set as `PUBLIC_URL`.

## Build

- A temporary dev-only route that answers the **dev number** (480) 530-8582 with `<Connect><ConversationRelay>`: `ttsProvider="ElevenLabs"`, `transcriptionProvider="Deepgram"`, `interruptible="speech"`, `welcomeGreeting`, `dtmfDetection="true"`, `events="speaker-events"`, and a `<Parameter>`.
- A temporary WebSocket at `/api/ai/spike` that says back what it heard ("You said: ...").
- Two or three ElevenLabs voices, switched by a query parameter, so Jeel can hear each.
- Log, per turn: time from the caller stopping to Seri starting (`last` prompt to first audio).
- Run once through a tunnel locally, and once on a throwaway server path if needed, to check Caddy passes `wss` on `/api/*`.

## Done when

- [x] Jeel has called it and **picked a voice**. The voice id is written in `docs/AI-AGENT.md` section 1 - Rachel on ElevenLabs's `v4` model, `21m00Tcm4TlvDq8ikWAM-v4-0.4_0.8`, 2026-11-12.
- [x] Talking over Seri stops her (`interrupt` message received) - with the words she had said and for how long.
- [x] Timing measured and written in `docs/AI-AGENT.md`: typical and slowest turn - our text to her voice 0.29 s median, 0.49 s slowest; the lead's last word to her first sound, with an echo, 0.66-1.06 s.
- [x] Confirmed: WebSocket works through Caddy (or the change Caddy needs is written down) - production's `/api/*` rule, unchanged.
- [x] Confirmed and written down: the WebSocket request carries `X-Twilio-Signature`, and what URL it is signed for (A10 checks it) - the `wss://` address as written, query included, no parameters.
- [x] Confirmed and written down: the shape of the `agentSpeaking` messages, and whether a `<Parameter>` arrives in `setup` - it does, under `customParameters`.
- [x] Confirmed and written down: **does `end` straight after a `text` cut the line short?** Say a long line, then `end`; then the same waiting for `agentSpeaking` off. The relay (A11) is built on the answer - it does not: the whole line is heard either way.
- [x] Confirmed: a key press arrives as a `dtmf` message.
- [x] The spike route and WebSocket are **removed** before merging, or never merged: only the findings are kept - never committed.

## Tests

- None automated: this is a measurement.

## Docs to update in the same commit

- `docs/AI-AGENT.md`: voice id, timings, Caddy finding, and the four confirmations above.

## Not in this ticket

- OpenAI. The echo is enough to test voice, listening and speed of the Twilio side.

## As built

- **Not a route in the app:** a standalone script, run beside the app on the dev number through a tunnel and a local Caddy 2 with production's `/api/*` rule, so nothing in `src/` changed and nothing had to be removed. It answered the number with a key menu: 1-5 the voices with an echo and the long-line tests (keys 1, 2, 3 on the call), 6 the settings A13 starts from, 9 the voices one after another on the same lines. The dev number was pointed back afterwards.
- **Recorded calls** - the dev number calling itself, both sides recorded - so the gap between the lead's last word and Seri's first sound was measured in the audio, not guessed from the messages.
- **Four voices, then a model:** the first round, on ElevenLabs's default model (`flash_v2`), did not sound human enough to Jeel; the second, on `v4` with stability 0.4 and similarity 0.8, picked Rachel.
- **Found beyond the ticket:** Deepgram's default `nova-3` splits a sentence at a pause, `flux` does not; `ignoreBackchannel` keeps "uh huh" from stopping her; a hang-up is `SessionStatus=completed` with no `HandoffData`; our WebSocket dropping is Twilio error 64105, then the `action` URL. All in `docs/AI-AGENT.md` section 1, "What the first test calls showed".
- **Changed by it:** A11 sends `end` straight after Seri's last line, with no wait for `agentSpeaking` off; A13 uses the settings in section 1.
- **Same day, from what the calls sounded like:** four speaking-style lines in the sales playbook - contractions, varied words, an occasional "So" or "Oh", matching the lead's mood (`docs/AI-AGENT.md` section 1, "Her words, not only her voice"; A04, A09).

Design: `docs/AI-AGENT.md`. All AI code in `backend/src/ai/`. One PR into `dev`.
