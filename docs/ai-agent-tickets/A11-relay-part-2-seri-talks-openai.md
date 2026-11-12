# A11 · Relay part 2: Seri talks (OpenAI)

**Goal:** The relay holds a real conversation through OpenAI, streamed and interruptible.

**Why:** This is Seri.

**Depends on:** A04, A05, A06, A10  ·  **Size:** Large (two days or more)  ·  **Status:** Done 2026-11-12

## Build

- On `setup`: build the instructions (A04) with the tools (A06). The `welcomeGreeting` Twilio already said goes into the history as Seri's first turn.
- **Who is there, on every lead turn** (`docs/AI-AGENT.md` section 3): before asking OpenAI, read whether someone is free, nobody is free but someone is coming, or nobody is there at all - the same SQL the transfer and the hold line use (`FREE_SQL`, who is coming). Sent with the turn, and passed to `toHandoff` so a transfer with nobody there is refused back to Seri.
- **The stop check, on every lead turn, before OpenAI:** the active script's `opt_out_words` (as `matchSpokenChoice` finds them), or key 9 (`dtmf`). A match ends the session as `opt_out` at once, with the script's stop line said first - whatever the AI would have answered.
- On each lead `prompt`: ask OpenAI with streaming; split the stream into sentences; each sentence through `checkSentence` (A05); send each as a `text` message as soon as it is ready.
- On `interrupt`: cancel the OpenAI stream, and keep in the history only what was actually said (`utteranceUntilInterrupt`).
- On a tool call: `toHandoff` (A06). An error goes back to OpenAI as the tool's answer. Otherwise Seri's last line is sent, the relay saves an `action` turn and `calls.ai_ended_with`, and sends `end` with `handoffData` straight after it - Twilio says the whole line before it ends the session (A02, `docs/AI-AGENT.md` section 1), so there is no wait for `agentSpeaking` off.
- Latency per turn saved in `call_ai_turns.latency_ms`.

## Done when

- [x] With a fake OpenAI: replies stream in sentences; an interrupt cuts the history; a tool call ends the session with the right `handoffData` straight after the last line; a blocked sentence is replaced - `conversation.test.ts` (28) and over a real WebSocket, `relay.test.ts`.
- [x] "Stop calling me" and key 9 end the session as `opt_out` even when the fake OpenAI answers something else - OpenAI is not even asked.
- [x] With nobody there, a transfer is refused back to Seri; with someone coming, it goes through - the SQL of who is there on a real Postgres too (`ai-agent-live-check`).

## Tests

- WebSocket tests with fake ConversationRelay and fake OpenAI.

## Docs to update in the same commit

- `docs/AI-AGENT.md` section 1.

## Not in this ticket

- Silence, 3 minutes, slow OpenAI (A12).

## As built

`docs/AI-AGENT.md` section 1, "How a reply is made". Files: `ai/conversation.ts` (one call's conversation), `ai/openai.ts` (the request, streamed), `ai/sentences.ts` (cutting the stream into sentences, pure), `saysStop` in `core/answers.ts`, and the relay (`ai/relay.ts`) and its store (`ai/relay-store.ts`: `whoIsThere`, `endAiCall`, the call's settings) changed to use them. Beyond the ticket:

- **The stop check reads stop words for a conversation**, not an answer: a phrase ("stop calling", "remove me") anywhere, but a single word ("stop") only said on its own. Built as the ticket said, "Do I need to stop my other medicine?" would have blocked the lead's number. Key 9 as the ticket says.
- **`end` straight after her last line**, with no wait for `agentSpeaking` off - A02 found Twilio says the whole line first. The ticket was written before that.
- **`calls.ai_ended_with` and `ai_agent.ended`**, recorded together, once (section 9 listed them).
- **A refused action, twice in a row: she waits for the lead**, rather than being asked again and again.
- **A replaced sentence ends that reply**, and an action in it waits: the specialist line asks a question.
- **The lead saying more before she answers** drops what she was writing; one reply answers all of it.
- **The answer test set builds the lead's turn with the call's own function** (`leadMessage`), so what is tested is what calls send.
- **Each reply's times are logged** - to her first sentence, and to OpenAI's first word - never her words.

**A real run** (the real API on a scratch database, a fake Twilio client, the real OpenAI): she answered "who is this" and "is this a scam" from the approved answers, saw nobody was free and offered a call back instead of a transfer, booked tomorrow at 3 PM inside the hours, and ended; another call ended at once on "Actually, stop calling me." First sentence 0.66-0.90 s after the lead's words, OpenAI's first word 0.54-0.85 s of it; a first run the same hour 1.19-1.75 s, all OpenAI's.

**Seen, for later tickets:** with nobody there she once still asked "Would you like me to connect you with someone now?" after an answer - when the lead said yes she offered a call back, as told - wording for the real-phone tests (A21) to watch. And "This is eDrugstore." for "Who is this?" is the approved answer word for word, without her name.

**Not in it:** silence, 3 minutes, a slow or failing OpenAI (A12) - until then a failed reply is logged (`ai_relay.model_failed`) and she says nothing more.

Design: `docs/AI-AGENT.md`. All AI code in `backend/src/ai/`. One PR into `dev`.
