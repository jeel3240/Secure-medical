# D19 · ADMIN.md

**Goal:** `ADMIN.md` in the Area template: one section per screen under How it works; the read-only rule and its exceptions in Decisions.

**Why:** It says no admin route takes POST - `POST /api/admin/config/ai-agent` exists (`api/admin/config.ts`), and the test only checks the base path (`admin-screens.test.ts`); "Phase 4 can add call figures back" - Phase 4 was done 2026-10-01; headings carry history (audit, 2026-11-27).

**Depends on:** D01, D03 · **Size:** M · **Status:** Done 2026-11-27 - `docs/ADMIN.md` in the Area sections, docs check passes · **Deploy note:** none - documentation only.

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

- `ADMIN.md` rewritten (359 lines): Configuration (The messages, Three tabs, The automated call, Seri's switch), Overview and DNC list under How it works; the read-only rule and its reasons (from CLAUDE.md §10, read, not edited) as Rules 1-2 and the Decisions table, with Seri's switch the one exception, linked to `AI-AGENT.md` section 7.
- Fixed: "no POST, PUT, PATCH or DELETE - tests assert that" - `POST /api/admin/config/ai-agent` exists; `admin-screens.test.ts` asserts 404 only on the three base paths and tests the switch route on its own. "Phase 4 can add call figures back" (Phase 4 done 2026-10-01) is now a Not done line.
- Added from the code: the switch's 400 `invalid_body` and 409 `no_key`, Overview's `invalid_period`/`invalid_tz`, the DNC list's `invalid_state`.

---

Standard: `docs/DOCS.md`. Tracker: [`README.md`](README.md). One branch off `dev`, merged `--no-ff`, in one commit.
