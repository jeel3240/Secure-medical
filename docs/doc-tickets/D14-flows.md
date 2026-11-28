# D14 · FLOWS.md

**Goal:** `FLOWS.md` in the Area template, with "How to add one" kept as its how-to part.

**Why:** It says the server's image contains `scripts/` - false since review H13 (`backend/Dockerfile`'s production stage); "The tables" repeats `SCHEMA.md`; its ADR is prose (audit, 2026-11-27).

**Depends on:** D01 · **Size:** S · **Status:** Done 2026-11-27 - FLOWS.md in the area template, the image claim fixed here and in dev-ask-again.ts; the docs check passes but for TESTING.md, still being written · **Deploy note:** none - documentation only.

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

- `FLOWS.md` in the area template, "How to add one" kept as its how-to part under How it works; rules numbered 1-11 (the database's 1-7, the code's 8-11); the tables' columns left to `SCHEMA.md`, which already has them; the endings' screens linked to `QUEUE.md` and `ADMIN-LEADS.md`.
- The real-phone walk to History, its EZ Texting findings handed to `EZTEXTING-API.md`; "Testing a flow with one phone" handed to `TESTING.md`, a stub of that name kept because `dev-ask-again.ts` quotes it.
- The server's image holds only `dist/`, `scripts/migrate.js` and the migrations since review H13 (`backend/Dockerfile`), not `scripts/` - fixed here and in the comment of `backend/scripts/dev-ask-again.ts`.

---

Standard: `docs/DOCS.md`. Tracker: [`README.md`](README.md). One branch off `dev`, merged `--no-ff`, in one commit.
