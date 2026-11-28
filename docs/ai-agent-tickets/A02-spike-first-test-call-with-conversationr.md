# A02 · Spike: first test call with ConversationRelay

**Goal:** Prove ConversationRelay works on our setup before building on it, and let Jeel pick Seri's voice.

**Why:** If the WebSocket does not pass through Caddy, or the voice or speed is bad, or Twilio cuts Seri's last line short, we find out now, not after A10-A14.

**Depends on:** A01 · **Size:** S · **Status:** Done 2026-11-12 - test calls on the dev number: her voice picked, the relay's ground confirmed

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

- [x] Jeel has called it and **picked a voice** *(replaced by Aria on A21's real calls, 2026-11-13 - `docs/AI-AGENT.md` section 1, "Her voice and tone")*. The voice id is written in `docs/AI-AGENT.md` section 1 - Rachel on ElevenLabs's `v4` model, `21m00Tcm4TlvDq8ikWAM-v4-0.4_0.8`, 2026-11-12.
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

**What the first test calls showed** - moved here from `docs/AI-AGENT.md` section 1 on 2026-11-27 (D42); the facts that still hold are in `docs/AI-RELAY.md`:

- **The server:** a throwaway one answered the dev number, (480) 530-8582, with `<ConversationRelay>` and said back what it heard - no OpenAI. Calls from Jeel's phone, and from the dev number calling itself, recorded on both sides so the gaps could be measured in the audio. It was never merged; only the findings were kept.
- **The voice, then:** Rachel on ElevenLabs's `v4` model, `21m00Tcm4TlvDq8ikWAM-v4-0.4_0.8`, picked by Jeel on 2026-11-12 from four voices (Rachel, Jessica, Matilda, Sarah) saying the same lines - the voice id, the model, then stability 0.4 and similarity 0.8, a little livelier than the default. With no model named Twilio used `flash_v2`, which Jeel found less human; with `v4` (and `v3`) the speed must be left out or be 1.0. She spoke about 160-200 words a minute on short lines; people on the phone speak about 165. Replaced by Aria on A21's real calls, 2026-11-13.
- **How fast:** our `text` to her voice starting, 0.29 s median and 0.49 s slowest over 17 turns, both models; the lead's last word to her first sound with an echo in place of the AI, 0.66-0.76 s with `nova-3` and 0.74-1.06 s with `flux`; with OpenAI's first word added (0.55 s on 2026-11-11, 0.92 s on 2026-11-12) about 1.3-1.9 s was expected - A11 measured it on every turn. People leave about 0.2 s between turns and more than about 0.8 s starts to feel slow, so the relay saves time where it can: words streamed, the first sentence sent the moment it is whole, a short first sentence (A11).
- **Listening:** `nova-3` took a short pause mid-sentence for the end of the turn and sent the two halves as two prompts - Seri would have answered half a sentence; `flux` waited for the whole thought, a little slower. "Uh huh" and "okay" said while she talked did not stop her with `ignoreBackchannel="true"`; speaking did, at once. The greeting can be talked over (`welcomeGreetingInterruptible="any"`, the default).
- **The settings A13 started from**, heard together on the dev number - the block in `docs/AI-RELAY.md`, "The settings", with Rachel's voice in place of Aria's and without A33's `partialPrompts` and `eotThreshold`. `interruptSensitivity="low"` and `elevenlabsTextNormalization="on"` were not tested on their own.
- **Twilio's docs, read 2026-11-11** before the calls: `SessionStatus` on the action URL (`ended` with our `HandoffData`, `failed` with `ErrorCode`, `completed`); the signature on the WebSocket request; `<Parameter>`s in `setup`; `events="speaker-events"`; `dtmfDetection="true"`. Not documented: whether `end` waits for her last words - it does. The account had to complete ConversationRelay's onboarding, with Twilio's AI features addendum, before the first call; done before these calls.
- **Her words, not only her voice** (Jeel, 2026-11-12): a natural voice still sounds like a machine reading when the words are written rather than spoken. Read against ElevenLabs' prompting guide for voice agents and Twilio's ConversationRelay best practices, her style already had short replies, acknowledging first, and "Sure", "Got it"; four lines were added to `style` in `sales-playbook.json` (`approved-2026-11-12`, `docs/AI-KNOWLEDGE.md`, "The versions"). The answer test set, old and new side by side in the same hour, three runs each: 198 and 199 of 201 - nothing lost. With an upset caller her replies varied more and apologised more often; the relay had to say her last line for her 17 times, against 31. Contractions barely changed: she already used them. How she sounded on a real phone was A21's to judge.
- **Confirmed, as A10 and A11 were built on it:** the signature is for the `wss://` address exactly as written, query included, no parameters; production's Caddy rule passes the WebSocket as it is, through a local Caddy 2 behind the tunnel; the messages as they arrived (`docs/AI-RELAY.md`, "What Twilio sends"); a 13-second line with `end` straight after it heard to the last word, Twilio ending the session about a second after `agentSpeaking` off; a hang-up `SessionStatus=completed`, `CallStatus=completed`, no `HandoffData`; the test server restarted mid-call - Twilio error 64105, then the action URL.

Design: `docs/AI-AGENT.md`. All AI code in `backend/src/ai/`. One PR into `dev`.
