# T9 · The server knows who is online

**Goal:** the server knows whose app is open and able to ring, within 2
minutes.

**Depends on:** - · **Size:** - · **Status:** Done 2026-10-18 · **Deploy note:** the
browser starts reporting; nothing visible.

## Build

- Migration 016: `users.ringable_until`.
- `POST /api/calls/ringable` (signed-in users), saying whether this browser
  can take a call now: registered with Twilio, and no call, ring or
  after-call note open. Sets `ringable_until` to 2 minutes from now, or
  clears it.
- The browser sends it from its existing 30-second check (`keepRegistered`),
  and at once when a call, a ring or a note box starts or ends.
- Signing out and deactivating an account clear it.

**Files:** `backend/src/db/migrations/016_presence.sql`, `backend/src/db/presence.ts`,
`backend/src/db/users.ts`, `backend/src/api/calls.ts` (+ test),
`backend/scripts/presence-live-check.ts`, `frontend/src/lib/presence.ts` (+ test),
`frontend/src/lib/calling.ts` (+ test), `frontend/src/lib/call-state.ts` (+ test),
`frontend/src/lib/incoming-state.ts` (+ test), `frontend/src/lib/incoming-call.ts`
(+ `layout/IncomingCall.test.tsx`),
`frontend/src/pages/workspace/useLeadCall.ts`, `frontend/src/api/calls.ts`.

## Done when

- [x] Route tests: signed-in only; available and busy both saved for the
      signed-in person; anything but true or false refused; refused with
      calling off.
- [x] A live check: available for 2 minutes, and again from the start when
      said again; busy (cleared); silent for 2 minutes (gone); signed out
      (cleared, nobody else's); deactivated (cleared, and never ringable
      again) - 17 checks.
- [x] Frontend tests: "not available" while the Twilio connection is down; at
      once when a call starts and when it is done; every 30 seconds; in
      order; nothing after signing out. Which call states keep the agent busy;
      an incoming ring keeps the browser busy until its note box is done, a
      missed call does not - 316 frontend tests.
- [x] Seen against Twilio, from the local app with calling switched on for the
      check (the dev number's settings, `dev-` names, nothing pointed): signed
      in -> "available", held 120 seconds, said again at 30 seconds; signed
      out -> cleared; no console errors.

## Docs to update in the same commit

`AUTO-CALLS.md`, "Who is free"; `TWILIO.md`, `SCHEMA.md`, `AUDIT.md`,
`AUTH.md`, `FRONTEND.md`, `README.md`, `WORKFLOW.md`, `CLAUDE.md`.

## As built

One change from the ticket - **when Twilio cannot be reached the
browser says "not available"** rather than nothing, so the server knows within
half a minute, not two. What keeps a browser busy is one small register,
`lib/presence.ts`, marked by the lead's call (`useLeadCall`) and the incoming
call (`lib/incoming-call.ts`); the rules are `occupiesAgent` and
`incomingOccupiesAgent`, pure. Reports go one after another, so an older
"available" never lands after a newer "busy". Nothing is said when the app
stops listening: signing out has already cleared it on the server, and a word
then could only be refused. Ending a session clears it in `db/users.ts`, the
one place every session ends - sign-out, deactivation, a password change -
so `api/auth/routes.ts` is unchanged. Not in the activity log. Nothing reads it
yet: T10 joins it to the switch.

---

Design: `docs/AUTO-CALLS.md`, `docs/AUTO-CALL-SCRIPT.md`, `docs/AUTO-CALL-TRANSFER.md`. Tracker:
[`README.md`](README.md). One branch off `dev`, one PR into `dev`, with its code, tests and
doc lines.
