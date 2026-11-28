# T4 · The database can hold a robot call

**Goal:** a call with no agent can be saved, and nothing mistakes it for an
agent's work.

**Depends on:** - · **Size:** - · **Status:** Done 2026-10-18 · **Deploy note:** none
- no robot calls exist yet.

## Build

- Migration 014:
  - `calls.direction` also allows `automated`.
  - The rule "an outbound call has an agent" becomes `direction <> 'outbound'
    OR agent_id IS NOT NULL`, so a robot call may have none.
  - `calls.script_result`: `transferred`, `transfer_missed`, `link_sent`,
    `not_interested`, `opted_out`, `no_response`, `voicemail_left`,
    `hung_up`, `unanswered`.
  - A robot calls a lead only once: unique index on `calls (lead_id) WHERE
    direction = 'automated'`.
- Every rule that reads calls says which directions it means:
  - Working (`WORKED_SQL`): an agent's call, an answered incoming call, or a
    robot call an agent took.
  - Answering a missed call (`MISSED_CALL_SQL`): not a robot call, unless an
    agent took it.
  - "The last agent who called" for incoming calls: includes a robot call an
    agent took.
  - End of call, voicemail verdict, transcript speakers: handle `automated`.

**Files:** `backend/src/db/migrations/014_automated_calls.sql`,
`backend/src/db/lead-state.ts`, `backend/src/db/calls.ts`,
`backend/src/db/timeline.ts`, `backend/src/core/calls.ts`,
`backend/src/core/transcripts.ts` (+ test), `backend/src/db/transcripts.ts`,
`backend/scripts/calls-live-check.ts`.

## Done when

- [x] A live check: a robot call with no agent leaves the lead not Working
      and a missed call still open - answered by the lead or under way.
- [x] A live check: once an agent takes it, the lead is Working, the missed
      call is answered, and a call back rings that agent.
- [x] The database refuses an agent's call without an agent, a second
      automated call to one lead, and a script result on any other call.
- [x] Every existing live check still passes - calls 104 (86 before), all 16.
- [x] The migration runs on the local database, which holds calls, and a
      second run applies nothing.

## Docs to update in the same commit

`SCHEMA.md`, `TWILIO.md`, `ADMIN-LEADS.md`, `LEAD-FLOW.md`,
`WORKFLOW.md`, `CLAUDE.md` §5 and §10.

## As built

One rule for both "Working" and "returned a missed call" - a call
counts when a person was on it (`agent_id` set), or an agent placed it; an
answered or ongoing call with nobody on it counts for neither. Existing rows
read exactly as before, since every answered or ongoing call so far has an
agent. The voicemail verdict is kept for automated calls too (T18 needs it),
and a transcript of one puts the lead on channel 1, as an incoming call does -
confirmed on a real transfer (T15a, 2026-10-20). `CallDirection` in
`core/calls.ts` is the one type for a call's direction.

---

Design: `docs/AUTO-CALLS.md`, `docs/AUTO-CALL-SCRIPT.md`, `docs/AUTO-CALL-TRANSFER.md`. Tracker:
[`README.md`](README.md). One branch off `dev`, one PR into `dev`, with its code, tests and
doc lines.
