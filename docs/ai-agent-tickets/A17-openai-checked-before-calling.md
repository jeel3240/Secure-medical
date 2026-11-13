# A17 · OpenAI checked before calling

**Goal:** The robot places no calls while OpenAI is down, so no lead's one call is spent on a broken Seri.

**Why:** Decided by Jeel, 2026-11-11.

**Depends on:** A12  ·  **Size:** Small (a few hours)

## Build

- `backend/src/ai/health.ts`: a tiny OpenAI request, result cached for 60 seconds.
- In `dialDueLeads` (`backend/src/worker/auto-calls.ts`): with Seri on and OpenAI down, place nothing this tick and log `ai_agent.openai_down` once.
- Three Seri calls in a row ending in `fallback` (`calls.ai_ended_with`, A08): pause like `REFUSED_PAUSE_MINUTES` (T28), then check OpenAI again.
- With Seri off, nothing here runs. The worker reads the same switch (`readAiAgentOn`, A01) and needs `OPENAI_API_KEY` too - passed to it since A01.

## From A12

- A fallback is `calls.ai_ended_with = 'fallback'`, written by the relay with why in `ai_agent.ended` - `model_failed`, `model_slow`, `socket_error`, `relay_failed` - and, for Twilio's own failures, by `/auto/ai-after` (A14). The relay's `end_call` for silence or the time limit is not a fallback, and does not count.

## Done when

- [ ] Worker test: OpenAI down places nothing; back up places again; three fallbacks pause.

## Tests

- Worker tests with a fake OpenAI health.

## Docs to update in the same commit

- `docs/AI-AGENT.md` section 6; `docs/AUTO-CALLS.md` "Traffic".

Design: `docs/AI-AGENT.md`. All AI code in `backend/src/ai/`. One PR into `dev`.
