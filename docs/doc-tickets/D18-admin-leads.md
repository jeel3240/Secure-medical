# D18 · ADMIN-LEADS.md

**Goal:** `ADMIN-LEADS.md` in the Area template; it owns the statuses, including Closed and Working.

**Why:** It says production has no robot calls "until `AUTO_CALLS` is on" - on since 2026-10-30; the queue membership list repeats `QUEUE.md` (audit, 2026-11-27).

**Depends on:** D01 · **Size:** M · **Status:** Done 2026-11-27 - `docs/ADMIN-LEADS.md` in the Area sections, docs check passes · **Deploy note:** none - documentation only.

## Build

- rewritten to the Area template (`docs/templates/AREA.md`): lead paragraph, How it works, Rules, Data, Code, Tests, Not done, Decisions, History;
- the status precedence as numbered Rules; the Call table kept; the stale line fixed; "Why Working and Closed were added" and the redesign table to History;
- the closed-lead reopening rule owned here (`CLOSED_SQL`); `AGENT-WORKSPACE.md`, `QUEUE.md` and `LEAD-FLOW.md` link.

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

- `ADMIN-LEADS.md` rewritten (428 lines): Status, Closed, Working, Step, Call, Filters, The response, The SQL, How fast it is, The page under How it works; the precedence as Rules 1; Rules 3-5 own `CLOSED_SQL` and the four things that reopen a closed lead.
- Fixed: "production, until `AUTO_CALLS` is on" (on since 2026-10-30) now reads "where automated calls are off"; "the DNC list keeps its view in memory" - it is in the address since review Q8; `page` capped at 100,000 (`parsePage`), and `call=all` refused.
- The queue membership list replaced by a link to `QUEUE.md`; "Why Working and Closed were added" and the redesign table are History; "Status is derived, never stored" is now "Status" (code already quoted "Status").
- Unsure: none of the fixes needed a guess; the closing reopen rules read straight from `CLOSED_SQL`.

---

Standard: `docs/DOCS.md`. Tracker: [`README.md`](README.md). One branch off `dev`, merged `--no-ff`, in one commit.
