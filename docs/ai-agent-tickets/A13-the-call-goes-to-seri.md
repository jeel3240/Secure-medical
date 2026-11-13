# A13 · The call goes to Seri

**Goal:** With the switch on, an answered automated call connects to Seri instead of the script.

**Why:** The switch that changes every call.

**Depends on:** A01, A10  ·  **Size:** Small (a few hours)  ·  **Status:** Done 2026-11-12

## Build

- `/auto/answer` in `backend/src/api/twilio-webhooks.ts`: when `readAiAgentOn` (A01) says on, reply with `<Connect action="/api/webhooks/twilio/auto/ai-after?call=...">` and `<ConversationRelay>` with the settings A02 found (`docs/AI-AGENT.md` section 1, "The settings A13 starts from": Rachel on `v4`, Deepgram's `flux`, `interruptible="speech"`, `ignoreBackchannel`, `dtmfDetection="true"`, `events="speaker-events"`), the opening as `welcomeGreeting` ("Hi, is this John?", or "Hi there"), the relay URL, and `<Parameter name="call">` with the row id. Off: exactly today's `firstAsk`.
- TwiML built in `backend/src/integrations/twilio.ts` next to `autoCallTwiml`.
- Machine detection unchanged.

## Done when

- [x] Off: every existing `/auto/answer` test passes unchanged - 93 webhook tests, untouched.
- [x] On: the TwiML has the right voice, greeting, action URL, relay URL and call parameter - the whole TwiML compared word for word.
- [x] On without `OPENAI_API_KEY`: today's script, and `ai_agent.no_key` logged once - over two calls, in the route tests and on the real API.

## Tests

- TwiML snapshot; on, off, on without a key.

## Docs to update in the same commit

- `docs/AI-AGENT.md` section 2; `docs/AUTO-CALLS.md` one line pointing to it.

## Not in this ticket

- Carrying out the action (A14).

## As built

- **Who takes the call is one function**, `seriGreeting` in `backend/src/ai/answer.ts`: the switch and the key (`readAiAgentOn`, A01), then the lead's first name for her greeting. Null sends the call to the script. `/auto/answer` reads the script first, for her too - it is her backup and holds her stop line - so no script ends the call quietly either way, as before.
- **The settings live in `backend/src/ai/relay-messages.ts`** - `RELAY_SETTINGS`, and `CALL_PARAMETER` (`call`), which the relay's `setup` reader uses too - so the TwiML and the relay cannot disagree. `seriTwiml` in `backend/src/integrations/twilio.ts` writes them as A02's calls did: the library's typings spell `ignorebackchannel` in lower case and leave out `applicationReconnect`, so its attributes are passed as written.
- **The key reaches the routes as `openAiKey`** (`api/deps.ts`), from `config.openai.apiKey`; the route tests' app takes one too.
- **No second of quiet before the greeting**, unlike the script's first question: Twilio says it as the relay connects. For A21 to listen for.
- **`auto_call.answered` says where the call went:** `to`, `seri` or `script`.
- **Tests:** the TwiML word for word, its relay address with no query, a name XML must escape (3, `integrations/twilio.test.ts`); the route - on with a name, with none, off and never set, on without a key over two calls, no script, the switch unreadable (6, `auto-call-webhooks.test.ts`). 1,555 backend tests. `seriGreeting` on a real Postgres - off, on with a name, without one, no key, off again at once (`ai-agent-live-check`, 72 checks).
- **Seen on the real API** (a scratch database, signed requests): the TwiML as above; a client connecting to the relay exactly as it said started Seri on that call - `ai_started_at`, `ai_agent.started`, her greeting as her first turn; switched off by the command while the API ran, the next call got the script; no key, the script and one `ai_agent.no_key`; no first name, "Hi there!".
- **Until A14** builds `/auto/ai-after`, the switch stays off: the end of her part would reach no page.

Design: `docs/AI-AGENT.md`. All AI code in `backend/src/ai/`. One PR into `dev`.
