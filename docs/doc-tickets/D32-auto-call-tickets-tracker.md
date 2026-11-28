# D32 · Phase 6's tracker out of AUTO-CALLS.md

**Goal:** `docs/auto-call-tickets/README.md` is Phase 6's tracker, in the `TRACKER.md` shape, and `DOCS.md` says how Phase 6's ids are written.

**Why:** `AUTO-CALLS.md` holds its tracker and 35 tickets inline - about 2,030 of its 3,203 lines (audit, 2026-11-27).

**Depends on:** D01 · **Size:** S · **Status:** Done 2026-11-27 - `docs/auto-call-tickets/README.md` in the tracker shape, 33 rows; `docs-check --type tracker` passes · **Deploy note:** none - documentation only.

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

- `docs/auto-call-tickets/README.md`: the 33 tickets in their groups, with their old statuses, "The rules every ticket keeps" (one branch and PR each, the gates, production kept working with `AUTO_CALLS` off, never production's number), "The order" with T15's split, the decisions paragraph, and a table of where each section the tickets quote is now. Size is `-`: the tickets were never sized.
- The id rule is written in the tracker - files `T00`-`T29`, `T13b`, `T15a`-`T15c`; the heading keeps the id the code cites (`# T0 · ...`). `DOCS.md` is not this rewriter's file: the rule and the Phase 6 row of "The phases" (tickets now in `auto-call-tickets/`) are handed over in the report.
- W1 and W2 have no ticket file: History lines handed to `AGENT-WORKSPACE.md` and `STATE-MACHINE.md`.
- T26: status `Done 2026-10-30`; its open box ticked - the robot live from 2026-10-30, about 200 calls on 2026-11-02 (T29). "Seen on the timeline and Admin > Leads" is inferred - for Jeel to confirm.

---

Standard: `docs/DOCS.md`. Tracker: [`README.md`](README.md). One branch off `dev`, merged `--no-ff`, in one commit.
