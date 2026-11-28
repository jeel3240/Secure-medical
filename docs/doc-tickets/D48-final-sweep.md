# D48 · The last sweep

**Goal:** Every doc meets the standard, and the check proves it.

**Why:** The closing ticket: what slipped between the others.

**Depends on:** every other D-ticket · **Size:** S · **Status:** To do · **Deploy note:** none - documentation only.

## Build

- `npm run docs:check` clean over the whole repo; each fact still owned once (a pass for repeats the per-doc tickets missed); `docs/README.md`'s table complete; the tracker closed - every row Done.

## Done when

- [ ] the docs check passes;
- [ ] every row of this tracker is Done.

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
