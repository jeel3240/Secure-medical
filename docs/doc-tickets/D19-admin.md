# D19 · ADMIN.md

**Goal:** `ADMIN.md` in the Area template: one section per screen under How it works; the read-only rule and its exceptions in Decisions.

**Why:** It says no admin route takes POST - `POST /api/admin/config/ai-agent` exists (`api/admin/config.ts`), and the test only checks the base path (`admin-screens.test.ts`); "Phase 4 can add call figures back" - Phase 4 was done 2026-10-01; headings carry history (audit, 2026-11-27).

**Depends on:** D01, D03 · **Size:** M · **Status:** To do · **Deploy note:** none - documentation only.

## Build

- rewritten to the Area template (`docs/templates/AREA.md`): lead paragraph, How it works, Rules, Data, Code, Tests, Not done, Decisions, History;
- the POST claim fixed (and the test's claim checked);
- Decisions: read-only (from CLAUDE.md §10, D03), Seri's switch the one control - linked to `AI-AGENT.md` §7, not restated;
- Overview, Configuration and DNC each a part of How it works.

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
