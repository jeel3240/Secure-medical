# T2 · `twilio:configure` cannot move production's number

**Goal:** the configure command cannot take production's number or TwiML App
away from production by accident.

**Depends on:** - · **Size:** - · **Status:** Done 2026-10-16 · **Deploy note:**
running it on the server works as today.

## Build

(as built)

- One pure rule, `core/twilio-pointing.ts`, for the number **and the TwiML
  App** - the app had no check at all before, and was changed before the
  number was looked at.
- Refused without `--take-over`: this app on another real server (production,
  from a laptop), an address that is not this app, a number answered by
  another TwiML App. Pointing nowhere, at an old tunnel, or at the same server
  is not a refusal - so the recovery (run it on the server after an accident)
  still works.
- Both are decided before either is changed: a refusal changes nothing, never
  half-moves them.
- `--dry-run` says what it would change and changes nothing.

**Files:** `backend/src/core/twilio-pointing.ts` (+ test),
`backend/src/cli/twilio-configure.ts`.

## Done when

- [x] Tests: refuses production's number from a tunnel; allows a tunnel,
      nothing, the same server; `--take-over` overrides; someone else's line
      and another TwiML App are refused (21 tests).
- [x] On production's real settings, read only: from a laptop, the number and
      the app are both refused; on the server, nothing to change.
- [x] The real command, `--dry-run`, against the dev number: both would be
      pointed, nothing was changed (checked on Twilio afterwards).

## Docs to update in the same commit

`TWILIO.md`, "What it needs on the Twilio account", "Settings" and
"Testing"; `WORKFLOW.md`; `CLAUDE.md` §4.

---

Design: `docs/AUTO-CALLS.md`, `docs/AUTO-CALL-SCRIPT.md`, `docs/AUTO-CALL-TRANSFER.md`. Tracker:
[`README.md`](README.md). One branch off `dev`, one PR into `dev`, with its code, tests and
doc lines.
