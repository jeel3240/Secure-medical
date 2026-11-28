# D09 · SCHEMA.md

**Goal:** `SCHEMA.md` is a reference: one table per database table - column, meaning, constraint, migration - and History.

**Why:** Its "Things worth knowing" holds behaviour other docs own; it says DNC is a retired disposition (it is not - `core/dispositions.ts`); it still calls the `createdAt` question open; it omits `ezt_poll_checkpoint` (audit, 2026-11-27).

**Depends on:** D01, D04 · **Size:** M · **Status:** To do · **Deploy note:** none - documentation only.

## Build

- a table per database table, from the migrations, not from memory;
- "Things worth knowing" to owners: claims → `AGENT-WORKSPACE.md`; `has_unread_inbound` → `QUEUE.md`/`STATE-MACHINE.md`; `agent_took_over_at` → `STATE-MACHINE.md` 2b; the LOW-tier analysis → `STATE-MACHINE.md`; repeat leads → `POLLER.md`; connecting and SSL → `DEPLOY.md`;
- "How to add an entry": a migration (`WORKFLOW.md`), then its rows here;
- the stale lines fixed; every "since 0NN" clause to History.

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
