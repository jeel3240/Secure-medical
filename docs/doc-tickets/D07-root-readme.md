# D07 · The root README

**Goal:** The root `README.md` is one screen pointing into `docs/`.

**Why:** It repeats the index and says architecture and the plan are in CLAUDE.md, which stops being true (audit, 2026-11-27).

**Depends on:** D02, D06 · **Size:** S · **Status:** Done 2026-11-27 - the root `README.md` is one screen of links into `docs/` · **Deploy note:** none - documentation only.

## Build

- what the app is in two lines; links to `docs/README.md`, `LEAD-FLOW.md`, `ARCHITECTURE.md`, `RUNNING.md`, `TESTING.md`, `DOCS.md`; nothing else.

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

root `README.md`.

## Not in this ticket

Rewriting any other doc - each has its own ticket.

## As built

- The root `README.md`, 20 lines: what the app is in two sentences; links to the index, `LEAD-FLOW.md`, `ARCHITECTURE.md`, `RUNNING.md`, `TESTING.md` and `DOCS.md`; a pointer to `CLAUDE.md`; a one-line History. The doc list it repeated is the index's, and it no longer says the architecture and the plan are in `CLAUDE.md`.

---

Standard: `docs/DOCS.md`. Tracker: [`README.md`](README.md). One branch off `dev`, merged `--no-ff`, in one commit.
