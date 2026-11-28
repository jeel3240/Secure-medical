# D09 · SCHEMA.md

**Goal:** `SCHEMA.md` is a reference: one table per database table - column, meaning, constraint, migration - and History.

**Why:** Its "Things worth knowing" holds behaviour other docs own; it says DNC is a retired disposition (it is not - `core/dispositions.ts`); it still calls the `createdAt` question open; it omits `ezt_poll_checkpoint` (audit, 2026-11-27).

**Depends on:** D01, D04 · **Size:** M · **Status:** Done 2026-11-27 - one section per table, 26 tables and `schema_migrations`, read from migrations 001-024; the docs check passes · **Deploy note:** none - documentation only.

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

- One `##` section per table - 26 tables and `schema_migrations` - with every column, its meaning, its constraint and index names and its migration, read from `backend/src/db/migrations/` 001-024; then "`settings` rows" (every key, its seed and its reader), "Seeded rows" and "Columns with no check". Every "since 0NN" clause is a History line.
- Fixed against the code: `dispositions.value` is `closed` or `dnc` - DNC is current; the retired values are `RETIRED_DISPOSITIONS` (`sold` among them). Added `ezt_poll_checkpoint`, `auto_calls_on`, `auto_calls_since` and `schema_migrations`. `expiry_days = 'banana'` is read as 7 (`expiryDays`), not a failure at the point of use. The `createdAt` question is closed (2026-11-27).
- Moved: claims' reasons to `AGENT-WORKSPACE.md`, rule 2b's "why a time" and the first flow's LOW-tier analysis to `STATE-MACHINE.md`, the opener-copy rule to `FLOWS.md`, connecting to RDS, `jit` and the pool timeout to `DEPLOY.md` - handoffs; `has_unread_inbound`'s behaviour was already `STATE-MACHINE.md`'s; `previous_lead_id`'s story is in History. The `calls` columns merged from the Twilio rewrite's handoff.

---

Standard: `docs/DOCS.md`. Tracker: [`README.md`](README.md). One branch off `dev`, merged `--no-ff`, in one commit.
