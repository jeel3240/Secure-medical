# D32 · Phase 6's tracker out of AUTO-CALLS.md

**Goal:** `docs/auto-call-tickets/README.md` is Phase 6's tracker, in the `TRACKER.md` shape, and `DOCS.md` says how Phase 6's ids are written.

**Why:** `AUTO-CALLS.md` holds its tracker and 35 tickets inline - about 2,030 of its 3,203 lines (audit, 2026-11-27).

**Depends on:** D01 · **Size:** S · **Status:** To do · **Deploy note:** none - documentation only.

## Build

- the tracker table (35 rows), the rules every ticket kept and the PR gates, into the new README;
- ids: files `T00`-`T29` (two digits), keeping the suffixes `T13b`, `T15a`-`T15c`; the heading keeps the id the code cites (`# T0 · ...`) - written into `DOCS.md`, "The fixed words", as Phase 6's exception;
- W1 and W2 are not calling work: each becomes a History line in the doc it changed (`AGENT-WORKSPACE.md`, `STATE-MACHINE.md`), not a ticket file;
- T26's status fixed: its tracker row says live, its own *Done when* still has an open box.

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

`DOCS.md`, `docs/README.md`, `AUTO-CALLS.md` (the tracker replaced by a link).

## Not in this ticket

Rewriting any other doc - each has its own ticket.

## As built

*Empty until the ticket is done.*

---

Standard: `docs/DOCS.md`. Tracker: [`README.md`](README.md). One branch off `dev`, merged `--no-ff`, in one commit.
