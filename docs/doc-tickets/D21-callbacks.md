# D21 · CALLBACKS.md

**Goal:** Callbacks - an agent's, a missed call's, Seri's, My Callbacks, the windows - in their own Area doc.

**Why:** They are a third of `AGENT-WORKSPACE.md` and pulled from four docs (audit, 2026-11-27).

**Depends on:** D20 · **Size:** S · **Status:** To do · **Deploy note:** none - documentation only.

## Build

- `docs/CALLBACKS.md` from `AGENT-WORKSPACE.md`'s callbacks sections, in the Area template; Seri's call-back pick-up rule owned here, `QUEUE.md` and `AI-AGENT.md` link.

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

`docs/README.md`, `AGENT-WORKSPACE.md`, the docs that pointed at the old sections, and code comments that quote them.

## Not in this ticket

Rewriting any other doc - each has its own ticket.

## As built

*Empty until the ticket is done.*

---

Standard: `docs/DOCS.md`. Tracker: [`README.md`](README.md). One branch off `dev`, merged `--no-ff`, in one commit.
