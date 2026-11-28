# D42 · Seri's call-by-call notes to the tickets

**Goal:** The "after call N" narratives live in the tickets that made the changes - A02, A09, A21, A34 - with one History line each in the doc.

**Why:** About 250 lines of `AI-AGENT.md` and 141 call references are the story of building her, not how she works (audit, 2026-11-27).

**Depends on:** D40 · **Size:** M · **Status:** To do · **Deploy note:** none - documentation only.

## Build

- each narrative moved to the As built of the ticket it belongs to; the doc keeps the rule it produced, in present tense.

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

`AI-AGENT.md`, `AI-BRAIN.md`, the four tickets.

## Not in this ticket

Rewriting any other doc - each has its own ticket.

## As built

*Empty until the ticket is done.*

---

Standard: `docs/DOCS.md`. Tracker: [`README.md`](README.md). One branch off `dev`, merged `--no-ff`, in one commit.
