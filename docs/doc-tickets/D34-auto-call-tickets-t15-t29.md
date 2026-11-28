# D34 · Tickets T15a-T29 into files

**Goal:** T15a-T29 each in their own file, the same way.

**Why:** As D33.

**Depends on:** D33 · **Size:** M · **Status:** Done 2026-11-27 - 17 files, `T15a` to `T29`; `AUTO-CALLS.md` holds no ticket; `docs-check --type ticket` passes · **Deploy note:** none - documentation only.

## Build

- as D33; T26's go-live and stop steps to `DEPLOY.md`, linked from the ticket.

## Done when

- [ ] each file's text equal to its old section but for the headings;
- [ ] `AUTO-CALLS.md` holds no ticket any more.

## Tests

The docs check (D47) once it exists; until then `grep` for every name the doc gives, and each link opened.

## Docs to update in the same commit

`docs/README.md`'s table if a doc is added, renamed or its type changes; the tracker's row.

## Not in this ticket

Rewriting any other doc - each has its own ticket.

## As built

- As D33. The body's real-call notes moved in: "What the real transfers showed" split across T15a, T15b and T15c; the hold line's calls into T16 and T17 (with call 46's two requests); voicemail's verdict counts and calls 56-62 into T18.
- T26's "Going live - Jeel's steps" and "To stop" moved to `DEPLOY.md` (handoff `DEPLOY.md.from-robot.md`, present tense); the ticket links it and keeps the steps as they were run on 2026-10-30 under *As built*.
- *As built* references updated to the current doc: T15a-T15c, T16, T17 (`AUTO-CALL-TRANSFER.md`), T18 (`AUTO-CALL-SCRIPT.md`), T19 (`INCOMING-CALLS.md`, "Who rings"), T20, T27-T29 (`AUTO-CALLS.md`), T21 (`TIMELINE.md`).

---

Standard: `docs/DOCS.md`. Tracker: [`README.md`](README.md). One branch off `dev`, merged `--no-ff`, in one commit.
