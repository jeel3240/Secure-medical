# D45 · BUCKETS.md

**Goal:** `BUCKETS.md` in the Area template, as Phase 8's design doc.

**Why:** Its Status is not in the fixed words; a "Proposed, waiting for the client" row sits in Decisions (an open question); the queue-order row belongs to `QUEUE.md`; "before Part 1 starts" contradicts the tracker, which starts about 40 tickets before; the order of work and the client questions repeat the tracker (audit, 2026-11-27).

**Depends on:** D01 · **Size:** S · **Status:** To do · **Deploy note:** none - documentation only.

## Build

- rewritten to the Area template (`docs/templates/AREA.md`): lead paragraph, How it works, Rules, Data, Code, Tests, Not done, Decisions, History, with a Status line in the fixed words;
- the proposal to Not done as an open question; the queue-order row to `QUEUE.md`; Parts 2 and 3 to Not done; the duplicated order and questions replaced by links to the tracker; the column tables left for B07/B09 to move into `SCHEMA.md`.

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
