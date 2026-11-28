# D17 · QUEUE.md

**Goal:** `QUEUE.md` in the Area template; it owns the queue's membership, order and tags.

**Why:** It names `AI_CALLBACK_DUE_SQL`, which does not exist (`PROMISED_CALLBACK_DUE_SQL`, `db/lead-state.ts`); "The polling hook" and "The one-agent lock on screen" are frontend; a decided but unbuilt change sits in the body (audit, 2026-11-27).

**Depends on:** D01 · **Size:** M · **Status:** Done 2026-11-27 - `docs/QUEUE.md` in the Area sections, docs check passes · **Deploy note:** none - documentation only.

## Build

- rewritten to the Area template (`docs/templates/AREA.md`): lead paragraph, How it works, Rules, Data, Code, Tests, Not done, Decisions, History;
- the constant fixed; the two frontend sections to `FRONTEND.md`; the speed tables to History; B01's decided order in Decisions, marked not built;
- the tag table owned here; `LEAD-FLOW.md` links.

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

- `QUEUE.md` rewritten to the Area template (360 lines): How it works - Who is in it, The order, The tag, Filters, The response, How fast it is - then Rules (9), Data, Code, Tests, Not done, Decisions (12), History.
- Fixed: `AI_CALLBACK_DUE_SQL` (gone since review D2) is `PROMISED_CALLBACK_DUE_SQL`/`_AT_SQL`; a due call back of a deactivated agent counts as promised too (`promisedCallbackDue`, `db/lead-state.ts`). `source` can be refused with `invalid_list`; `since=all` is accepted.
- The polling hook and the on-screen lock handed to `FRONTEND.md` (scratchpad handoff); the closed-lead table to `ADMIN-LEADS.md`, "Closed"; Seri's and deactivated agents' call backs to `CALLBACKS.md`. The speed tables are History lines; B01's tier-first order is in Decisions, marked not built, and kept as one line under "The order".
- Code comments still quoting moved sections (`usePolling.ts` names `QUEUE.md` for the polling decision) are listed for a later code pass; the brief forbade code edits.

---

Standard: `docs/DOCS.md`. Tracker: [`README.md`](README.md). One branch off `dev`, merged `--no-ff`, in one commit.
