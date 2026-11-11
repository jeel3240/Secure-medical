# A10 · Relay part 1: connection and storage

**Goal:** Our WebSocket accepts ConversationRelay for a real automated call and keeps every turn.

**Why:** The pipe first, without OpenAI, so it can be tested on its own.

**Depends on:** A01, A08  ·  **Size:** Medium (about a day)

## Build

- `backend/src/ai/relay.ts`: a `ws` server on `/api/ai/relay`, attached to the API's HTTP server in `backend/src/api/index.ts`.
- **Who may connect:** the connection request must carry Twilio's signature (`X-Twilio-Signature`) for the relay's URL, checked with the same function as every Twilio webhook (A02 confirms which URL Twilio signs). Unsigned, or signed for another URL: the socket is closed. No token is stored.
- The call is named by a `<Parameter name="call">` in the TwiML (A13), which arrives in `setup` under `customParameters`. A call that is not automated, not ours, or already has an `ai_started_at`: closed.
- On `setup`: load the call, the lead (first name, phone), mark `calls.ai_started_at` and `ai_knowledge_version`.
- Every `prompt` (the lead) and every reply (Seri) saved to `call_ai_turns`. Text never in logs.
- For this ticket, Seri just says a fixed line, so it can be tested end to end.

## Done when

- [ ] A fake ConversationRelay client test connects, sends setup and prompts, and the turns are in the database.
- [ ] An unsigned or wrongly signed connection, and a second `setup` for the same call, are refused.

## Tests

- WebSocket tests with a fake client.

## Docs to update in the same commit

- `docs/AI-AGENT.md` section 9.

## Not in this ticket

- OpenAI (A11), limits (A12).

Design: `docs/AI-AGENT.md`. All AI code in `backend/src/ai/`. One PR into `dev`.
