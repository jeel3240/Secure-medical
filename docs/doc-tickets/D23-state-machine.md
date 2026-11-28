# D23 · STATE-MACHINE.md

**Goal:** `STATE-MACHINE.md` in the Area template, keeping rule numbers 1-4 and 2b-2d, which other docs point at.

**Why:** About 50 dated lines and 15 "Decided by Jeel" inline; "Seen before" called a computed tag (not built); opening versus picking clears the flag, both said; return detection "checked" and "unverified"; a returning `review` lead restarts, against `BUCKETS.md` decision 2; a real-format number (audit, 2026-11-27).

**Depends on:** D01 · **Size:** M · **Status:** Done 2026-11-27 - STATE-MACHINE.md in the area template, rule numbers kept; the docs check passes · **Deploy note:** none - documentation only.

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

- `STATE-MACHINE.md` in the area template; rules 1-4 and 2b-2d kept, as `####` under Rules, "What a reply does"; the inline decisions in a table (two undated "Decided:" given 2026-09-19, the spec's date); test counts dropped; 654 lines, about 80 of them History.
- Fixed: "Seen before" is said not to exist; the read flag clears when a lead is picked, not opened (`AGENT-WORKSPACE.md`, "Marking a lead read"); "A number that comes back" says today's behaviour and the 2026-11-27 answer, its never-built 2026-09-19 rules - which restarted a `review` lead, against `BUCKETS.md` - moved to History. The real-format number the audit named was already gone after D01.

---

Standard: `docs/DOCS.md`. Tracker: [`README.md`](README.md). One branch off `dev`, merged `--no-ff`, in one commit.
