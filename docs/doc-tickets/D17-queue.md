# D17 · QUEUE.md

**Goal:** `QUEUE.md` in the Area template; it owns the queue's membership, order and tags.

**Why:** It names `AI_CALLBACK_DUE_SQL`, which does not exist (`PROMISED_CALLBACK_DUE_SQL`, `db/lead-state.ts`); "The polling hook" and "The one-agent lock on screen" are frontend; a decided but unbuilt change sits in the body (audit, 2026-11-27).

**Depends on:** D01 · **Size:** M · **Status:** To do · **Deploy note:** none - documentation only.

## Build

- rewritten to the Area template (`docs/templates/AREA.md`): lead paragraph, How it works, Rules, Data, Code, Tests, Not done, Decisions, History;
- the constant fixed; the two frontend sections to `FRONTEND.md`; the speed tables to History; B01's decided order in Decisions, marked not built;
- the tag table owned here; `LEAD-FLOW.md` links.

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
