# A08 · Migration 022

**Goal:** The database can store Seri's calls, turns and call backs.

**Why:** Every later ticket that writes data needs these columns.

**Depends on:** nothing  ·  **Size:** Small (a few hours)

## Build

- `backend/src/db/migrations/022_ai_agent.sql` (021 is on `main`, so this is a new file):
  - `calls.ai_started_at`, `calls.ai_knowledge_version`
  - `calls.ai_ended_with`: one of the five actions or `fallback` (CHECK), null when the lead hung up first or Seri never took the call; only on an automated call
  - `calls.script_result` check gains `callback_booked`
  - table `call_ai_turns` (id, call_id, who: lead/seri/action/system, text, latency_ms, created_at), add-only by trigger like `call_answers`, index on call_id
  - `callbacks.agent_id` nullable **only** for reason `ai_booked`; the reason check gains `ai_booked`; a `booked_by_call_id`
  - `settings` row `ai_agent` = `off`, `ON CONFLICT DO NOTHING` - the command (A01) may already have written it on a laptop
- It changes constraints and adds columns; it changes no existing row.

## Done when

- [ ] `npm run migrate` runs on an empty database and on a copy at 021.
- [ ] A `booked` or `missed_call` callback without an agent is still refused.
- [ ] `ai_ended_with` refuses a value that is not an action or `fallback`, and any value on a call that is not automated.
- [ ] `docs/SCHEMA.md` updated.

## Tests

- A live check: the new constraints accept and refuse what they should; `call_ai_turns` cannot be edited or deleted.

## Docs to update in the same commit

- `docs/SCHEMA.md`, CLAUDE.md section 5 line for 022.

## Not in this ticket

- Writing to the tables (A10, A15).

Design: `docs/AI-AGENT.md`. All AI code in `backend/src/ai/`. One PR into `dev`.
