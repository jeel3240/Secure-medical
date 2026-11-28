# D42 · Seri's call-by-call notes to the tickets

**Goal:** The "after call N" narratives live in the tickets that made the changes - A02, A09, A21, A34 - with one History line each in the doc.

**Why:** About 250 lines of `AI-AGENT.md` and 141 call references are the story of building her, not how she works (audit, 2026-11-27).

**Depends on:** D40 · **Size:** M · **Status:** Done 2026-11-27 - the narratives in the As built of A02, A09, A21 and A34 · **Deploy note:** none - documentation only.

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

- A21's As built holds "Her voice and tone" (calls 86-91) and the fixes after calls 89, 92 (twice), 93, 94, 95, 96, 99 and 101, 99 and 100, 103, 109 and 111, word for word with their section pointers re-aimed; A34's holds calls 114, 118-120, 118-119 (the saved introduction), 122, the one-request brain's removal after call 122, and calls 127, 129, 130, 135, 136-137.
- A02's As built holds "What the first test calls showed" and "Her words, not only her voice"; A09's how it was run, the tone counts and its removal.
- The doc keeps the rule each produced, in the present tense (`AI-BRAIN.md`, "Rules"), and one History line per group of calls in `AI-AGENT.md` and `AI-BRAIN.md`.
- The Progress tables of A21 and A34 point to their own As built instead of `AI-AGENT.md` sections that no longer exist.

---

Standard: `docs/DOCS.md`. Tracker: [`README.md`](README.md). One branch off `dev`, merged `--no-ff`, in one commit.
