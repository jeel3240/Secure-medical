# D14 · FLOWS.md

**Goal:** `FLOWS.md` in the Area template, with "How to add one" kept as its how-to part.

**Why:** It says the server's image contains `scripts/` - false since review H13 (`backend/Dockerfile`'s production stage); "The tables" repeats `SCHEMA.md`; its ADR is prose (audit, 2026-11-27).

**Depends on:** D01 · **Size:** S · **Status:** To do · **Deploy note:** none - documentation only.

## Build

- rewritten to the Area template (`docs/templates/AREA.md`): lead paragraph, How it works, Rules, Data, Code, Tests, Not done, Decisions, History;
- the image claim fixed, and the same stale comment in `backend/scripts/dev-ask-again.ts`;
- "The tables" replaced by links to `SCHEMA.md`; the endings' queue and Admin effects linked to `QUEUE.md`/`ADMIN-LEADS.md`;
- the real-phone walk to History; "Testing a flow with one phone" to `TESTING.md`.

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
