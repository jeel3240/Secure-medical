# A31 · What the new brain keeps, and picking a call back up

**Goal:** every reply keeps what was understood, what was decided and the call's record, and a call whose line dropped picks up from that record.

**Why:** "Nothing may be lost" (`docs/AUDIT.md`), and "why did she say that?" must be answerable from the database. Today's resume rebuilds the conversation from the turns (`resume.ts`); the record must come back with it - and a deploy is exactly when the code that rebuilds it may have changed, so the record is kept, not replayed.

**Depends on:** A30  ·  **Size:** M  ·  **Status:** Done 2026-11-17

## Build

- Migration 024: `call_ai_turns.data jsonb`, only on `system` rows (a check). One row at each commit point - the brain's version, the acts, the moves, the record - added, never changed.
- `resume.ts`: the last record and the lead's turns after it.
- `scripts/end-to-end.ts`: its OpenAI stand-in tells an understand request (`response_format`) from a reply.

## Done when

- [x] `resume.test.ts` and `brain.test.ts`, `npm run e2e` (142, its reconnect step included), `ai-agent-live-check` (137) and every live check pass.

## As built

`docs/AI-AGENT.md` section 12, "As built: what is kept, and picking a call back up (A31)". Two changes from the ticket: the record is kept at each reply, before and after, so resume needs no replay - with its reply said when her turn followed it; and **`npm run e2e` was not moved to the new brain** - its OpenAI stand-in answers today's requests, so it still proves the call around the brain; the new brain's whole calls are A32's replays, against the real OpenAI. *(Moved 2026-11-19, when today's brain was removed: `npm run e2e` now runs the new brain - `new Brain` with understand and speak - and its stand-in answers understand's strict JSON and speak's stream; `docs/README.md`, "How to test".)*

## Docs to update in the same commit

- `docs/AI-AGENT.md` sections 2 and 9, `SCHEMA.md`, `WORKFLOW.md` (migration 024), this tracker, `CLAUDE.md`.
