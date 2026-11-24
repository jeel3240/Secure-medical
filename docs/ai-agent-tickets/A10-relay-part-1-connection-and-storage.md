# A10 · Relay part 1: connection and storage

**Goal:** Our WebSocket accepts ConversationRelay for a real automated call and keeps every turn.

**Why:** The pipe first, without OpenAI, so it can be tested on its own.

**Depends on:** A01, A08  ·  **Size:** Medium (about a day)  ·  **Status:** Done 2026-11-12

## Build

- `backend/src/ai/relay.ts`: a `ws` server on `/api/ai/relay`, attached to the API's HTTP server in `backend/src/api/index.ts`.
- **Who may connect:** the connection request must carry Twilio's signature (`X-Twilio-Signature`) for the relay's URL, checked with the same function as every Twilio webhook (A02 confirms which URL Twilio signs). Unsigned, or signed for another URL: the socket is closed. No token is stored.
- The call is named by a `<Parameter name="call">` in the TwiML (A13), which arrives in `setup` under `customParameters`. A call that is not automated, not ours, or already has an `ai_started_at`: closed.
- On `setup`: load the call, the lead (first name, phone), mark `calls.ai_started_at` and `ai_knowledge_version`.
- Every `prompt` (the lead) and every reply (Seri) saved to `call_ai_turns`. Text never in logs.
- For this ticket, Seri just says a fixed line, so it can be tested end to end.

## Done when

- [x] A fake ConversationRelay client test connects, sends setup and prompts, and the turns are in the database - `relay.test.ts` against a fake database; the SQL in `ai-agent-live-check`; and by hand, the real API on a scratch database.
- [x] An unsigned or wrongly signed connection, and a second `setup` for the same call, are refused - 403 before any WebSocket; the second connection closed, `already_started`, also when two race.

## Tests

- WebSocket tests with a fake client.

## Docs to update in the same commit

- `docs/AI-AGENT.md` section 9.

## Not in this ticket

- OpenAI (A11), limits (A12).

## As built

`docs/AI-AGENT.md` section 9, "As built (A10)". Beyond the ticket:

- **Three files, not one:** `relay.ts` (the WebSocket and the session), `relay-messages.ts` (the address, the signature check and each message Twilio sends, pure - as A02 recorded them) and `relay-store.ts` (the SQL). `relayUrl` is there for A13's TwiML.
- **Refused before a WebSocket opens:** an unsigned request gets a plain 403 and never a socket; another path a 404. The relay is attached only with automated calls on.
- **"Not ours" is exact:** `setup`'s `callSid` must be the row's `twilio_call_sid` - which `/auto/answer` saves before it answers (T12) - so a signed connection naming another call's row is refused (`other_call`). And a call already ended, or with a script result, is `over`.
- **`ai_agent.started`** in the activity log, in the same transaction as `ai_started_at` (section 9 listed it).
- **Her greeting is her first turn** - Twilio says it, from the same `welcomeGreeting` A13 uses - so the record starts where the call does.
- **More than prompts and replies are kept:** a key as `(pressed 1)`; being cut off and Twilio's errors as `system` notes. Partial and empty prompts are not turns.
- **In order:** one message at a time, so a prompt arriving while `setup` is being saved waits for it.
- **The fixed line:** "Thanks. Someone from our team will be in touch soon." - never heard by a lead: no call reaches the relay before A13, and A11 replaces it.

Design: `docs/AI-AGENT.md`. All AI code in `backend/src/ai/`. One PR into `dev`.
