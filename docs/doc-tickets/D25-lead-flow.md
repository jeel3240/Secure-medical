# D25 · LEAD-FLOW.md

**Goal:** `LEAD-FLOW.md` is the short "start here" page: the two diagrams and one linked line per status - nothing restated.

**Why:** Almost all of it restates `ADMIN-LEADS.md`, `QUEUE.md`, `AGENT-WORKSPACE.md`, `AI-AGENT.md` and `STATE-MACHINE.md`; it says Seri is not deployed; its four "What changed" sections are history, out of date order (audit, 2026-11-27).

**Depends on:** D02, D17, D18, D20 · **Size:** S · **Status:** Done 2026-11-27 - `docs/LEAD-FLOW.md` the short map, one linked line per status; the docs check passes · **Deploy note:** none - documentation only.

## Build

- the diagrams kept (and shown in `ARCHITECTURE.md`'s "How they connect"); each status one line with a link to its owner; "What changed on..." to History, in date order; the stale Seri line fixed.

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

- `LEAD-FLOW.md` (map, about 140 lines): the owners table; the two diagrams kept; Every status - one line each with its owner; the robot's call and Seri as two short pointers; the queue's tags, Working a lead and Ways back as pointers; the four "What changed" sections to History, in date order, with the Seri and robot-call notes that had been in the body.
- Fixed: "built, not yet deployed" for Seri - she is on production with her switch off since 2026-11-24; `ADMIN-LEADS.md`, "Status is derived, never stored" is now "Status"; the antibiotics flow is `FLOWS.md`'s.
- `ARCHITECTURE.md`, "How they connect" links these diagrams rather than drawing them a second time.

---

Standard: `docs/DOCS.md`. Tracker: [`README.md`](README.md). One branch off `dev`, merged `--no-ff`, in one commit.
