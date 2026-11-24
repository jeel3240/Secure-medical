# A17 · OpenAI checked before calling

**Goal:** The robot places no calls while OpenAI is down, so no lead's one call is spent on a broken Seri.

**Why:** Decided by Jeel, 2026-11-11.

**Depends on:** A12  ·  **Size:** Small (a few hours)  ·  **Status:** Done 2026-11-12

## Build

- `backend/src/ai/health.ts`: a tiny OpenAI request, result cached for 60 seconds.
- In `dialDueLeads` (`backend/src/worker/auto-calls.ts`): with Seri on and OpenAI down, place nothing this tick and log `ai_agent.openai_down` once.
- Three Seri calls in a row ending in `fallback` (`calls.ai_ended_with`, A08): pause like `REFUSED_PAUSE_MINUTES` (T28), then check OpenAI again.
- With Seri off, nothing here runs. The worker reads the same switch (`readAiAgentOn`, A01) and needs `OPENAI_API_KEY` too - passed to it since A01.

## From A12

- A fallback is `calls.ai_ended_with = 'fallback'`, written by the relay with why in `ai_agent.ended` - `model_failed`, `model_slow`, `socket_error`, `relay_failed` - and, for Twilio's own failures, by `/auto/ai-after` (A14) - built: `why` is `twilio_failed`, written only when the relay recorded nothing. The relay's `end_call` for silence or the time limit is not a fallback, and does not count.

## Done when

- [x] Worker test: OpenAI down places nothing; back up places again; three fallbacks pause - and off places as before, and nothing is asked with no room or outside the hours.

## Tests

- Worker tests with a fake OpenAI health.

## Docs to update in the same commit

- `docs/AI-AGENT.md` section 6; `docs/AUTO-CALLS.md` "Traffic".

## As built

- **`backend/src/ai/health.ts`:** `openAiProbe` - a one-word request to her model, `max_completion_tokens: 1`, 5 seconds, no retries, OpenAI's failure as its status and code (`plainError`); `cachedProbe` - up or down kept 60 seconds, two looks at once sharing one request; `fallbackStreak` - her last three calls whose part ended all `fallback`, the latest started within the pause; `seriState` - off, then paused, then OpenAI, each asked only when the one before allows.
- **`dialDueLeads`** gained `seriReady`, asked inside the dial lock once there is room to place calls - never to place none, never outside the hours. `openai_down` or `ai_fallbacks` stops the look with nothing looked up; `look.aiError` carries OpenAI's status and code.
- **The pause** is `REFUSED_PAUSE_MINUTES` (15), passed in by the worker - so `ai/health.ts` loads no database pool and is tested on its own.
- **Logged once** each, as the robot's other stops: `ai_agent.openai_down` with `err`, `ai_agent.fallbacks_paused`; `auto_call.dialling_again` when it starts again.
- **The switch** is read on every look by the worker too (`readAiAgentOn`): on without a key is off there as well - calls go out with the script.
- **Tests:** the probe against a local OpenAI - up, a refused key, a failure, one request each; the cache; the order of the questions (9); the dialler (6 more, 15); `fallbackStreak` on a real Postgres - two, three, a hang-up between, the pause over, one more, broken (`ai-agent-live-check`, 107).
- **Seen on the real OpenAI:** the real key up (about 2 s, a first connection), a wrong key down as `OpenAI 401 invalid_api_key` in 0.5 s - no part of the key in it.

Design: `docs/AI-AGENT.md`. All AI code in `backend/src/ai/`. One PR into `dev`.
