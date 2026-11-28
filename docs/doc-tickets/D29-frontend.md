# D29 · FRONTEND.md, what remains

**Goal:** `FRONTEND.md` is about 250 lines in the Area template: the shell, the routes, fetching, the lock, the types, code and tests.

**Why:** After D26-D28 move the rest out; its stale lines - 453 tests in 40 files (41 now), a pointer to a section that does not mention the row flash, controls removed since Phase 4, the stack missing `@twilio/voice-sdk` (audit, 2026-11-27).

**Depends on:** D26, D27, D28 · **Size:** M · **Status:** To do · **Deploy note:** none - documentation only.

## Build

- rewritten to the Area template (`docs/templates/AREA.md`): lead paragraph, How it works, Rules, Data, Code, Tests, Not done, Decisions, History;
- the stale lines fixed; the two review logs and dated headings to History; a "Differences from the brief" table (D30).

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
