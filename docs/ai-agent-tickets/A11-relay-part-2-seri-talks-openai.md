# A11 · Relay part 2: Seri talks (OpenAI)

**Goal:** The relay holds a real conversation through OpenAI, streamed and interruptible.

**Why:** This is Seri.

**Depends on:** A04, A05, A06, A10  ·  **Size:** Large (two days or more)

## Build

- On `setup`: build the instructions (A04) with the tools (A06). The `welcomeGreeting` Twilio already said goes into the history as Seri's first turn.
- **Who is there, on every lead turn** (`docs/AI-AGENT.md` section 3): before asking OpenAI, read whether someone is free, nobody is free but someone is coming, or nobody is there at all - the same SQL the transfer and the hold line use (`FREE_SQL`, who is coming). Sent with the turn, and passed to `toHandoff` so a transfer with nobody there is refused back to Seri.
- **The stop check, on every lead turn, before OpenAI:** the active script's `opt_out_words` (as `matchSpokenChoice` finds them), or key 9 (`dtmf`). A match ends the session as `opt_out` at once, with the script's stop line said first - whatever the AI would have answered.
- On each lead `prompt`: ask OpenAI with streaming; split the stream into sentences; each sentence through `checkSentence` (A05); send each as a `text` message as soon as it is ready.
- On `interrupt`: cancel the OpenAI stream, and keep in the history only what was actually said (`utteranceUntilInterrupt`).
- On a tool call: `toHandoff` (A06). An error goes back to OpenAI as the tool's answer. Otherwise Seri's last line is sent, the relay saves an `action` turn and `calls.ai_ended_with`, and sends `end` with `handoffData` straight after it - Twilio says the whole line before it ends the session (A02, `docs/AI-AGENT.md` section 1), so there is no wait for `agentSpeaking` off.
- Latency per turn saved in `call_ai_turns.latency_ms`.

## Done when

- [ ] With a fake OpenAI: replies stream in sentences; an interrupt cuts the history; a tool call ends the session with the right `handoffData` straight after the last line; a blocked sentence is replaced.
- [ ] "Stop calling me" and key 9 end the session as `opt_out` even when the fake OpenAI answers something else.
- [ ] With nobody there, a transfer is refused back to Seri; with someone coming, it goes through.

## Tests

- WebSocket tests with fake ConversationRelay and fake OpenAI.

## Docs to update in the same commit

- `docs/AI-AGENT.md` section 1.

## Not in this ticket

- Silence, 3 minutes, slow OpenAI (A12).

Design: `docs/AI-AGENT.md`. All AI code in `backend/src/ai/`. One PR into `dev`.
