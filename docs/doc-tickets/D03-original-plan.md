# D03 · The original plan, out of CLAUDE.md

**Goal:** `CLAUDE.md` §10 - the four-week plan, the weeks, the Phase 3 task list, the progress tables and the phases table - leaves CLAUDE.md for the docs that own each part.

**Why:** §10 is most of CLAUDE.md's length and is history, read at the start of every session (audit, 2026-11-27). `DOCS.md`: CLAUDE.md carries no phase history.

**Depends on:** D01 · **Size:** M · **Status:** To do · **Deploy note:** none - documentation only.

## Build

- `docs/ORIGINAL-PLAN.md`, a Brief: the four weeks, their "done when", the Phase 3 task list and the progress tables, as they were - with one note at the top pointing to what was built;
- the phases table - each phase's one-line summary - into `DOCS.md`, "The phases" (the long Phase 7 and 8 rows become their design docs' Status and History);
- "Admin is read-only" and its why, and Seri's switch as the one control, into `ADMIN.md`'s Decisions;
- the open items ("Source always reads API", the deep-health limit, repeat leads) into their owners' Not done: `QUEUE.md`/`ADMIN-LEADS.md`, `LOGGING.md`, `POLLER.md` (repeat leads: settled by the 2026-11-27 check, `EZTEXTING-API.md`);
- the deploy state ("`main` holds 001-024") into `WORKFLOW.md` only.

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

`CLAUDE.md` (§10 replaced by a pointer), `DOCS.md`, `ADMIN.md`, the owners named above, `docs/README.md`.

## Not in this ticket

The rest of CLAUDE.md (D04, D05).

## As built

*Empty until the ticket is done.*

---

Standard: `docs/DOCS.md`. Tracker: [`README.md`](README.md). One branch off `dev`, merged `--no-ff`, in one commit.
