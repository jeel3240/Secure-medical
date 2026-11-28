# T10 · The "Taking calls" switch

**Goal:** only people who switched "Taking calls" on are rung for transfers
or counted as free.

**Depends on:** T9 · **Size:** - · **Status:** Done 2026-10-18 · **Deploy note:** none
- the switch shows only when `AUTO_CALLS` is on.

## Build

- Migration 017: `users.taking_calls` (off by default) and `taking_calls_at`.
- `POST /api/calls/taking-calls` to switch it on or off.
- Off at every sign-in and every sign-out.
- Every change is recorded: `calls.availability_changed`, with on/off and
  why (`by_hand`, `sign_in`, `sign_out`, and later `missed_transfer`).
- The switch in the app bar, beside the user menu, in the app's style.
- `GET /api/calls/config` says whether `AUTO_CALLS` is on;
  `docker-compose.yml` passes `AUTO_CALLS` to the api and the worker.
- One shared definition of **free** (`FREE_SQL`): active, switch on, app open,
  not on a call. Used by every later ticket.

**Files:** `backend/src/db/migrations/017_taking_calls.sql`,
`backend/src/auto-calls-settings.ts` (+ test), `backend/src/api/taking-calls.ts`,
`backend/src/api/calls.ts`, `backend/src/api/auth/routes.ts`,
`backend/src/api/deps.ts`, `backend/src/api/index.ts`,
`backend/src/api/users/types.ts`, `backend/src/db/users.ts`,
`backend/src/db/presence.ts`, `backend/src/core/activity.ts`,
`backend/src/api/__tests__/taking-calls.test.ts`,
`backend/scripts/presence-live-check.ts`, `frontend/src/layout/TakingCalls.tsx`
(+ test), `frontend/src/layout/AppShell.tsx`, `frontend/src/api/calls.ts`,
`frontend/src/api/types.ts`, `frontend/src/styles/shell.css`,
`docker-compose.yml`, `.env.example`.

## Done when

- [x] Tests: off after sign-in and sign-out; on and off by hand; every change
      in the activity log, and nothing that did not change; refused with
      automated calls off, and anything but true or false refused - 13 route
      tests; `AUTO_CALLS` read only as exactly `on` - 8 tests.
- [x] A live check: switch off -> not free; on but on a call -> not free; on,
      app open, not on a call -> free, superadmin or agent. Also: a browser
      silent or busy, a lead ringing them, a call never reported ended, an
      automated call before and after its transfer is taken, a deactivated
      account; the time it changed kept only on a change - presence check,
      34 checks.
- [x] The switch is hidden with `AUTO_CALLS` off - tested, and seen.
- [x] Seen in the local app with calling and automated calls on for the check
      (dev settings): off after sign-in; switched on -> saved, and free once
      the browser registered with Twilio; still on after a reload; signing out
      -> off, not free; recorded `by_hand`, then `sign_out`; no console
      errors.

## Docs to update in the same commit

`AUTO-CALLS.md`, `AUDIT.md`, `AUTH.md`, `SCHEMA.md`, `FRONTEND.md`,
`LOGGING.md`, `README.md`, `WORKFLOW.md`, `CLAUDE.md`.

## As built

`AUTO_CALLS` is read by `auto-calls-settings.ts` - on only when it
says exactly `on`; `off` or empty is off, and any other value is off and
logged once (`auto_calls.off`) - never a reason to refuse to start. Automated calls count as on only with
calling set up too, decided once in `api/index.ts` (`deps.autoCalls`). The
switch lives on the user (`takingCalls` on the signed-in user), so the app
bar reads it from the sign-in store. It flips only once the server has it.
The rule is `FREE_SQL`, with `freePeople`, and migration 017 also adds
`calls_under_way_by_agent`, a small index of the calls still going.

---

Design: `docs/AUTO-CALLS.md`, `docs/AUTO-CALL-SCRIPT.md`, `docs/AUTO-CALL-TRANSFER.md`. Tracker:
[`README.md`](README.md). One branch off `dev`, one PR into `dev`, with its code, tests and
doc lines.
