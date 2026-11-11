# A01 · Setup: packages, OpenAI key, on/off switch

**Goal:** The app can hold an OpenAI key and knows whether Seri is on or off.

**Why:** Every later ticket needs the key and the switch. Nothing calls OpenAI yet.

**Depends on:** nothing  ·  **Size:** Small (a few hours)  ·  **Status:** Done 2026-11-11

## Build

- Add the `openai` and `ws` packages to `backend/package.json`.
- `OPENAI_API_KEY` read in `backend/src/config.ts` (optional). Add it to `.env.example` with a one-line comment, to the env table in `docs/README.md`, and to **both** the api and the worker in `docker-compose.yml` - every variable is listed per service there, and the worker checks OpenAI before placing calls (A17).
- `backend/src/ai/settings.ts`: `readAiAgentOn()` reads the `ai_agent` row in `settings` on every call. Missing row, or any value but `on`, means **off**. **On without `OPENAI_API_KEY` is off too**, logged once.
- **The switch is a server command** (Jeel, 2026-11-11): `npm run ai-agent -- on|off` (`backend/src/cli/ai-agent.ts`) writes the setting and an activity-log row in one transaction - production's database is never edited by hand. No restart. `on` is refused without the key.

## Done when

- [x] `npm test` and `npm run lint` pass - 1,064 backend tests (8 new), lint clean; 407 frontend.
- [x] `docker compose build api worker` builds, and the image has `dist/cli/ai-agent.js` and loads `openai` and `ws` on Node 20.
- [x] With no `ai_agent` row, `readAiAgentOn()` is false.
- [x] The key never appears in a log line: the logger redacts any field whose name ends in `key` (`openaiApiKey`, `OPENAI_API_KEY`, `apiKey` - tested), and nothing logs the key's value.
- [x] Each switch is one `ai_agent.switched` row, in the same transaction; a switch to what it already is writes nothing; two at once take turns (`activity-live-check`, 52 checks).
- [x] Run against the local database: a bad argument prints the usage; `on` with no key is refused and writes nothing; `off` switches and records once; `off` again changes nothing.

## Tests

- `readAiAgentOn`: missing row, `on`, `off`, `ON`, junk; on without a key - off, and logged once, not on every call.
- The command's argument; `on` refused without a key, `off` always allowed.
- The key redacted from a log line.
- `activity-live-check`: switched on with no row, on again, off, a value it cannot read, two at once.

## Docs to update in the same commit

- `docs/README.md` env table.
- `docs/AI-AGENT.md` section 7.
- `docs/AUDIT.md` (`ai_agent.switched`), `docs/LOGGING.md` (`ai_agent.no_key`), `CLAUDE.md`.

## Not in this ticket

- The settings row's seed (A08 adds it, `off`, without overwriting what the command wrote).
- Any call to OpenAI.

## As built

- **No startup refusal**, unlike the first version of this ticket ("on + no key in production refuses to start"). The switch changes while the API runs, so a startup check would only see it at the next restart - and would take down the queue, the texts and every screen for something whose fallback is today's script. Instead the command refuses `on` without the key, and on without a key counts as off, logged once as `ai_agent.no_key`.
- **`openai` 6.x** (`^6.49.0`), not 7: version 7 needs Node 22, and the app runs Node 20. `ws` 8, with `@types/ws`.
- The record's actor is null - the command is run by someone on the server, who is no user of the app - with `via: 'command'`. `from` is what the row said before, kept as it was even when it was not `on` or `off`.
- The command also says when `AUTO_CALLS` is off, since then no call is placed either way.

Design: `docs/AI-AGENT.md`. All AI code in `backend/src/ai/`. One PR into `dev`.
