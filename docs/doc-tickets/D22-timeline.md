# D22 · TIMELINE.md

**Goal:** The lead timeline - its sources, events and wordings - in its own Area doc.

**Why:** It is a separate part of the app, inside `AGENT-WORKSPACE.md` (audit, 2026-11-27); B12 changes it next.

**Depends on:** D20 · **Size:** S · **Status:** To do · **Deploy note:** none - documentation only.

## Build

- `docs/TIMELINE.md` from `AGENT-WORKSPACE.md`'s timeline section, in the Area template, naming `db/timeline.ts` and `components/Timeline.tsx`.

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

`docs/README.md`, `AGENT-WORKSPACE.md`, B12's ticket (its docs line).

## Not in this ticket

Rewriting any other doc - each has its own ticket.

## As built

*Empty until the ticket is done.*

---

Standard: `docs/DOCS.md`. Tracker: [`README.md`](README.md). One branch off `dev`, merged `--no-ff`, in one commit.
