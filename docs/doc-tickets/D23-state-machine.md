# D23 · STATE-MACHINE.md

**Goal:** `STATE-MACHINE.md` in the Area template, keeping rule numbers 1-4 and 2b-2d, which other docs point at.

**Why:** About 50 dated lines and 15 "Decided by Jeel" inline; "Seen before" called a computed tag (not built); opening versus picking clears the flag, both said; return detection "checked" and "unverified"; a returning `review` lead restarts, against `BUCKETS.md` decision 2; a real-format number (audit, 2026-11-27).

**Depends on:** D01 · **Size:** M · **Status:** To do · **Deploy note:** none - documentation only.

## Build

- rewritten to the Area template (`docs/templates/AREA.md`): lead paragraph, How it works, Rules, Data, Code, Tests, Not done, Decisions, History;
- the rules gathered under Rules with their numbers; "What is built" and "Shape of the code" to Code; "Tests the state machine needs" to Tests; "Open items" to Not done; decisions to the table;
- the contradictions fixed; "A number that comes back" to History, linking `BUCKETS.md`; test counts removed.

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
