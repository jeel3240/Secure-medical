# D30 · DESIGN-PROMPT.md's notes to their owners

**Goal:** Every fact in `DESIGN-PROMPT.md`'s 61 notes lives in the doc that owns it.

**Why:** The brief is frozen (`DOCS.md`, "Brief"); its notes are the app's record, in the wrong place (audit, 2026-11-27).

**Depends on:** D29 · **Size:** S · **Status:** To do · **Deploy note:** none - documentation only.

## Build

- each note's fact to its owner (queue notes to `QUEUE.md`, read-only admin to `ADMIN.md`...); gaps nobody owns - no toasts, no shortcuts, a spinner not a skeleton, no "Assign to", no draft save, Settings not built - into `FRONTEND.md`'s "Differences from the brief".

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

the owners, `FRONTEND.md`.

## Not in this ticket

Rewriting any other doc - each has its own ticket.

## As built

*Empty until the ticket is done.*

---

Standard: `docs/DOCS.md`. Tracker: [`README.md`](README.md). One branch off `dev`, merged `--no-ff`, in one commit.
