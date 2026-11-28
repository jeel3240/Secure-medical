# D10 · AUDIT.md

**Goal:** `AUDIT.md` is a reference: the rule, the actions table, the archive table, how to add an action, History.

**Why:** It says 40 actions (there are 41), that every action is recorded in a test (`dev.test_reset` is not), and holds screen and history sections (audit, 2026-11-27).

**Depends on:** D01 · **Size:** M · **Status:** To do · **Deploy note:** none - documentation only.

## Build

- a short Rules lead (written with the action; cannot be altered); the actions table checked against `ACTIVITY_ACTIONS` (`core/activity.ts`); "How to add an entry"; "On the screen" to `AGENT-WORKSPACE.md`/`FRONTEND.md`; "What was being lost" to History; counts removed.

## Done when

- [ ] the doc's sections are its type's, in the type's order (`docs/DOCS.md`)
- [ ] no dated note, "As built" or "until" aside left in the body - each is a line in History
- [ ] every fact another doc owns is a link, not a copy
- [ ] every file, function, setting and route it names exists (`grep`)
- [ ] every link resolves, and every code comment that quotes a moved or renamed section is updated
- [ ] nothing lost: each removed sentence is either still true somewhere, or in History

## Tests

The docs check (D47) once it exists; until then `grep` for every name the doc gives, and each link opened.

## Docs to update in the same commit

`docs/README.md`'s table if a doc is added, renamed or its type changes; the tracker's row.

## Not in this ticket

Rewriting any other doc - each has its own ticket.

## As built

*Empty until the ticket is done.*

---

Standard: `docs/DOCS.md`. Tracker: [`README.md`](README.md). One branch off `dev`, merged `--no-ff`, in one commit.
