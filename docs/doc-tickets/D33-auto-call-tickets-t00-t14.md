# D33 · Tickets T0-T14 into files

**Goal:** T0-T14 and T13b each in their own file, on the `TICKET.md` headings, losing nothing.

**Why:** Each already has Goal, Needs, Production, Build, Done when, As built, Files and Doc - they map straight on (audit, 2026-11-27).

**Depends on:** D32 · **Size:** M · **Status:** To do · **Deploy note:** none - documentation only.

## Build

- Needs → Depends on; Production → Deploy note; Files → Build; Doc → Docs to update; As built kept as it is - a finished ticket's record; nothing reworded but the headings.

## Done when

- [ ] 16 files; each one's text equal to its old section but for the headings (a diff in the PR);
- [ ] the tracker's links resolve.

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
