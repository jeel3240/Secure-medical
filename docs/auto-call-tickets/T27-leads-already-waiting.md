# T27 · The leads already waiting at the switch-on

**Goal:** the leads already waiting for a reply when automated calls are
switched on are called too, without holding up new leads. Jeel, 2026-10-29:
about 562 leads were awaiting a reply on production - "whatever is in
awaiting answer stage gets called", with no manual start or stop.

**Depends on:** T20 · **Size:** - · **Status:** Done 2026-10-29 - called too, after
new leads, nothing by hand · **Deploy note:** with automated calls on, the leads
already waiting are called, after new leads.

## Build

- The robot calls every lead it would call anyway, whenever it arrived - no
  longer only those after the switch-on.
- New leads first; the waiting ones fill the room left, oldest first.

**Files:** `backend/src/db/auto-dial.ts`, `backend/src/worker/auto-calls.ts`,
`backend/scripts/auto-dial-live-check.ts`, `backend/scripts/end-to-end.ts`
(a comment).

## Done when

- [x] A live check: a lead from before the switch-on picked, after the new
      ones; the new leads first, then the waiting ones oldest first; the room
      to the new leads first, what is left to the waiting ones; asked again
      before its call, still due; one who replied or was picked up never
      called (`auto-dial-live-check`, 61 checks).
- [x] Every live check, the unit tests and `npm run e2e` unchanged otherwise.

## Docs to update in the same commit

`AUTO-CALLS.md`, "When a lead is called", "Leads already waiting" and
"Going live"; `AUDIT.md`, `SCHEMA.md`, `README.md`, `WORKFLOW.md`, `CLAUDE.md`.

## As built

`AUTO-CALLS.md`, "Leads already waiting". First built the same day as a command run
by hand on the server (`auto-calls:include-waiting`, with `--dry-run` and
`--stop`, and a setting per switch-on); Jeel did not want a manual start or
stop, so it was replaced before release by the rule above, and the command,
its setting and its two activity actions removed.

---

Design: `docs/AUTO-CALLS.md`, `docs/AUTO-CALL-SCRIPT.md`, `docs/AUTO-CALL-TRANSFER.md`. Tracker:
[`README.md`](README.md). One branch off `dev`, one PR into `dev`, with its code, tests and
doc lines.
