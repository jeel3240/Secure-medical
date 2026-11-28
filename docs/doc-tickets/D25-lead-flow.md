# D25 · LEAD-FLOW.md

**Goal:** `LEAD-FLOW.md` is the short "start here" page: the two diagrams and one linked line per status - nothing restated.

**Why:** Almost all of it restates `ADMIN-LEADS.md`, `QUEUE.md`, `AGENT-WORKSPACE.md`, `AI-AGENT.md` and `STATE-MACHINE.md`; it says Seri is not deployed; its four "What changed" sections are history, out of date order (audit, 2026-11-27).

**Depends on:** D02, D17, D18, D20 · **Size:** S · **Status:** To do · **Deploy note:** none - documentation only.

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

*Empty until the ticket is done.*

---

Standard: `docs/DOCS.md`. Tracker: [`README.md`](README.md). One branch off `dev`, merged `--no-ff`, in one commit.
