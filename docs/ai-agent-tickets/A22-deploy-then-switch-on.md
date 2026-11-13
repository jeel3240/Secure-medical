# A22 · Deploy, then switch on

**Goal:** Seri goes live on every call.

**Why:** The last step.

**Depends on:** A21  ·  **Size:** Small (a few hours)

## Build

The steps are `docs/WORKFLOW.md`'s, "Seri, the AI agent" - every command with
both `-f` files, as production runs:

- Merge `dev` into `main`. Deploy after 5 PM Arizona time, when the robot is
  not calling.
- Put `OPENAI_API_KEY` in the server's `.env` first, so the `up -d --build`
  recreates the api and the worker with it. Added later, recreate both with
  `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d api worker`
  - a `restart` keeps the old environment.
- Pull, `up -d --build`, then **`npm run migrate` straight after the `up`**
  (022 and 023): until they have run, the lead page, its timeline and My
  Callbacks read columns that are not there yet. Neither changes an existing
  row; 023 (A15) adds `callbacks.note`, Seri's one-line reason on a call back
  she books, and one call back per call.
- Recreate Caddy after the `up` - this deploy changes the `Caddyfile`, which a
  running Caddy never rereads: `docker compose -f docker-compose.yml -f
  docker-compose.prod.yml up -d --force-recreate caddy` (`docs/WORKFLOW.md`).
  It holds Seri's reconnect while the api restarts, so a call with her lives
  through a deploy (`docs/AI-AGENT.md` section 2, "When the line drops").
- `ai_agent` stays `off` (022 seeds it): calls go on exactly as today, the
  script from its first question.
- Next calling day, switch her on - no restart, recorded in the activity log,
  refused without the key:
  `docker compose -f docker-compose.yml -f docker-compose.prod.yml exec api npm run ai-agent -- on`
- Watch the first calls: each lead's timeline shows her conversation under the
  call (A19), and the logs are in CloudWatch, log group `/leads-app`, streams
  `api` and `worker` - `ai_relay.*`, `auto_call.ai_after`, `auto_call.dial`
  (`docs/LOGGING.md`). The words are only in `call_ai_turns`, never the logs.
- Off again at any time with `-- off`: a call already with her finishes; the
  next call gets the script.

## Done when

- [ ] Deployed with Seri off and nothing changed; then on, and the first real Seri calls look right.

## Tests

- -

## Docs to update in the same commit

- `docs/WORKFLOW.md` deploy notes; `docs/AI-AGENT.md` status line.

Design: `docs/AI-AGENT.md`. All AI code in `backend/src/ai/`. One PR into `dev`.
