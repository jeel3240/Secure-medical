# D40 · AI-BRAIN.md

**Goal:** Seri's brain - understand, decide, speak, the record, the evals - in its own area doc, with the policy's rules numbered.

**Why:** `AI-AGENT.md` is 887 lines with 193 dates; section 12 is a part of its own; lines describing the removed one-request brain (`leadTurn`, `NO_REPEAT_NOTE`...) still stand (audit, 2026-11-27).

**Depends on:** D01 · **Size:** M · **Status:** To do · **Deploy note:** none - documentation only.

## Build

- `docs/AI-BRAIN.md` from section 12, in the Area template, saying only what the code does today (`ai/brain.ts`, `understand.ts`, `policy.ts`, `speak.ts`); the removed brain to History.

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

`docs/README.md`, `AI-AGENT.md`, code comments quoting section 12.

## Not in this ticket

Rewriting any other doc - each has its own ticket.

## As built

*Empty until the ticket is done.*

---

Standard: `docs/DOCS.md`. Tracker: [`README.md`](README.md). One branch off `dev`, merged `--no-ff`, in one commit.
