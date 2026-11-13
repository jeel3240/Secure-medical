# A22 · Deploy, then switch on

**Goal:** Seri goes live on every call.

**Why:** The last step.

**Depends on:** A21  ·  **Size:** Small (a few hours)

## Build

- Merge `dev` into `main`. Deploy after 5 PM as usual: pull, build, **migrate (022 and 023)**, up. 023 (A15) adds `callbacks.note`, Seri's one-line reason on a call back she books, and one call back per call; like 022 it changes no existing row.
- Server `.env`: `OPENAI_API_KEY`, then recreate the api and the worker (`up -d api worker`; a restart keeps the old environment). `ai_agent` stays `off`: calls exactly as today.
- Next calling day, switch it on with the command - no restart, recorded in the activity log:
  `docker compose -f docker-compose.yml -f docker-compose.prod.yml exec api npm run ai-agent -- on`
- Watch the first calls in `call_ai_turns` and the logs.
- Off again at any time with `-- off`: every call back on the script, a call already with Seri left to finish.

## Done when

- [ ] Deployed with Seri off and nothing changed; then on, and the first real Seri calls look right.

## Tests

- -

## Docs to update in the same commit

- `docs/WORKFLOW.md` deploy notes; `docs/AI-AGENT.md` status line.

Design: `docs/AI-AGENT.md`. All AI code in `backend/src/ai/`. One PR into `dev`.
