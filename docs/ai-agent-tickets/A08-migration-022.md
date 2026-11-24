# A08 · Migration 022

**Goal:** The database can store Seri's calls, turns and call backs.

**Why:** Every later ticket that writes data needs these columns.

**Depends on:** nothing  ·  **Size:** Small (a few hours)  ·  **Status:** Done 2026-11-11

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

- [x] `npm run migrate` runs on an empty database and on a copy at 021 - every live check's scratch database from empty; and the local database, at 021 with 85 calls (67 automated) and 2 callbacks, migrated, then a second run applied nothing. The `off` the A01 command had written there was kept.
- [x] A `booked` or `missed_call` callback without an agent is still refused.
- [x] `ai_ended_with` refuses a value that is not an action or `fallback`, and any value on a call that is not automated.
- [x] `docs/SCHEMA.md` updated.

## Tests

- A live check, `scripts/ai-agent-live-check.ts` (34 checks): the switch starts off; Seri's columns - started with the version, ended only after a start, each action and `fallback`, nothing else, never on an agent's call; `callback_booked` allowed, earlier results still allowed, a result still refused on an agent's call; the turns - all four kinds, anyone else refused, a time only on Seri's turns and never negative, kept in order, never changed or deleted; the call backs - hers with no agent or with one, an agent's own and a missed call's still needing an agent, hers always naming its call and nobody else's naming one, any other reason refused. Twenty-three live checks in all.

## Docs to update in the same commit

- `docs/SCHEMA.md`, CLAUDE.md section 5 line for 022.

## Not in this ticket

- Writing to the tables (A10, A15).

## As built

- **More rules held by the database than the ticket listed**, each named: `calls_ai_started_with_version` (the start and the version are written together), `calls_ai_ended_after_start`, `calls_ai_is_automated` (all three columns, not only `ai_ended_with`); `latency_ms` only on Seri's turns, and never negative; `callbacks_ai_names_its_call` - every `ai_booked` call back names its call, and no other kind names one.
- `call_ai_turns` is indexed by `(call_id, id)`: the timeline (A19) reads one call's turns in order.
- **Found while building, for A15:** every query that reads `callbacks` was written when every callback had an agent. Two need a decision when Seri's bookings are written - `WORKED_SQL` counts any callback as a person's work, and the queue's Callback tag joins `users` - written down in A15. Nothing changes now: no row without an agent exists until then. *(Resolved: A15 left `ai_booked` out of `WORKED_SQL`; A16 made the queue's callback join keep a callback with no agent.)*
- `activity-live-check`'s A01 case assumed no `ai_agent` row; on a database at 022 it now starts from the seeded `off`, and tries "never set" by removing the row (54 checks).
- Deploy notes: `docs/WORKFLOW.md`, "Where the files stand" - it changes no existing row, and with the switch off calls go on as today.

Design: `docs/AI-AGENT.md`. All AI code in `backend/src/ai/`. One PR into `dev`.
