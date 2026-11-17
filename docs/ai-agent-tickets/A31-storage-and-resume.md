# A31 · What the new brain keeps, and picking a call back up

**Goal:** every reply keeps what was understood, what was decided and the call's record, and a call whose line dropped picks up from that record.

**Why:** "Nothing may be lost" (`docs/AUDIT.md`), and "why did she say that?" must be answerable from the database. Today's resume rebuilds the conversation from the turns (`resume.ts`); the record must come back with it - and a deploy is exactly when the code that rebuilds it may have changed, so the record is kept, not replayed.

**Depends on:** A30  ·  **Size:** M  ·  **Status:** To do

## Build

- Migration 024: `call_ai_turns.data jsonb`, only on `system` rows (a check). One row at each commit point - the brain's version, the acts, the moves, the record - added, never changed.
- `resume.ts`: the last record and the lead's turns after it.
- `scripts/end-to-end.ts`: its OpenAI stand-in tells an understand request (`response_format`) from a reply.

## Done when

- [ ] `resume.test.ts`, `npm run e2e` (its reconnect step included), `ai-agent-live-check` and every live check pass.

## Docs to update in the same commit

- `docs/AI-AGENT.md` sections 2 and 9, `SCHEMA.md`, `WORKFLOW.md` (migration 024), this tracker, `CLAUDE.md`.
