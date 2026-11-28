# B48 · Second bucket: robot script

**Goal:** the second bucket's leads who do not reply get a robot call with its own
script.

**Why:** `BUCKETS.md`, order of work step 2.

**Depends on:** B47 · **Size:** S · **Status:** Dropped 2026-11-27 - new buckets have no robot script; their calls are Seri's (Jeel) ·
**Deploy note:** a migration with new rows only.

## Build

- A migration: its call script - steps, choices, the link text, the voicemail and hold
  lines - with robot calls still off.
- A call on the dev number with the script; then robot calls switched on in production
  from Admin.

## Done when

- [ ] `scripts/call-script-live-check.ts`: the script word for word, its guards.
- [ ] The dev call, recorded; robot calls on in production, the first call recorded.

## Tests

As above.

## Docs to update in the same commit

`docs/AUTO-CALL-SCRIPT.md` ("The script"), `docs/SCHEMA.md`, `docs/WORKFLOW.md`, `docs/BUCKETS.md`.

## Not in this ticket

Its Seri (B49).

## As built

*Empty until the ticket is done.*

---

Design: `docs/BUCKETS.md`. Tracker: [`README.md`](README.md) - its rules and gates apply to every ticket. One branch off `dev`, merged `--no-ff`, code, tests and docs in one commit.
