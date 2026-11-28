# T29 · Five calls at once for each person free

**Goal:** agents taking calls are kept busy: the robot places five calls at
once for each person free, not one. Jeel, 2026-11-02: on production about 200
robot calls that day put 3 leads through to a person.

**Depends on:** T20 · **Size:** - · **Status:** Done 2026-11-02 - a setting, 5,
migration 021; one before · **Deploy note:** once deployed with migration 021, the
robot places up to five calls for each person free.

## Build

(as built: `AUTO-CALLS.md`, "Traffic")

- `callsToPlace`: the people free times `perPerson`, less the calls going.
- `perPerson` is a settings row, `auto_call_calls_per_person`, 5 (migration
  021), read on every look (`readCallsPerPerson`, in `dialRoom`); anything
  but a whole number from 1 to 10 is 5.
- Shown on Admin > Configuration > Calls: "Calls at once - 5 for each person
  free".
- Nothing else changes: a "yes" nobody free can take waits on the hold line
  while someone is coming, and the robot places nothing while it waits.

**Files:** `backend/src/db/migrations/021_calls_per_person.sql`,
`backend/src/core/auto-dial.ts` (+ test), `backend/src/db/call-script.ts`
(+ `calls-per-person.test.ts`), `backend/src/db/auto-dial.ts`,
`backend/src/worker/auto-calls.ts` (+ test), `backend/src/db/admin-config.ts`,
`frontend/src/api/admin.ts`, `frontend/src/pages/admin/ConfigPage.tsx`,
`backend/scripts/auto-dial-live-check.ts`, `backend/scripts/call-script-live-check.ts`,
`backend/scripts/admin-live-check.ts`, `backend/scripts/end-to-end.ts`.

## Done when

- [x] Tests: five for each person free, less the calls going; the setting's
      number, one included; a look never asks for more leads than the room;
      the setting read, and every value it cannot use 5 (1,056 backend
      tests).
- [x] A live check: two free, five each, one call going - nine placed, the
      next look none; the setting read on every look, and one it cannot
      read 5 (`auto-dial-live-check`, 69); the setting as migration 021 seeds
      it (`call-script-live-check`, 33); on Admin > Configuration
      (`admin-live-check`, 77). `npm run e2e` - 98 checks: the setting is 5,
      then set to 1 so its three robot calls go one at a time, as each story
      needs.

## Docs to update in the same commit

`AUTO-CALLS.md` ("Traffic", "Leads already waiting"); `ADMIN.md`,
`SCHEMA.md`, `WORKFLOW.md`, `README.md`, `CLAUDE.md`.

## As built

Built as *Build* says.

---

Design: `docs/AUTO-CALLS.md`, `docs/AUTO-CALL-SCRIPT.md`, `docs/AUTO-CALL-TRANSFER.md`. Tracker:
[`README.md`](README.md). One branch off `dev`, one PR into `dev`, with its code, tests and
doc lines.
