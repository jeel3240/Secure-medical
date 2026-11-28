# D34 · Tickets T15a-T29 into files

**Goal:** T15a-T29 each in their own file, the same way.

**Why:** As D33.

**Depends on:** D33 · **Size:** M · **Status:** To do · **Deploy note:** none - documentation only.

## Build

- as D33; T26's go-live and stop steps to `DEPLOY.md`, linked from the ticket.

## Done when

- [ ] each file's text equal to its old section but for the headings;
- [ ] `AUTO-CALLS.md` holds no ticket any more.

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
