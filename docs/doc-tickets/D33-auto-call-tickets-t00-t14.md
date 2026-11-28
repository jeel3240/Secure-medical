# D33 · Tickets T0-T14 into files

**Goal:** T0-T14 and T13b each in their own file, on the `TICKET.md` headings, losing nothing.

**Why:** Each already has Goal, Needs, Production, Build, Done when, As built, Files and Doc - they map straight on (audit, 2026-11-27).

**Depends on:** D32 · **Size:** M · **Status:** Done 2026-11-27 - 16 files, `T00` to `T14` and `T13b`, every old line found in them; `docs-check --type ticket` passes · **Deploy note:** none - documentation only.

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

- Generated from the old sections, only the headings mapped: Needs -> *Depends on*, Production -> *Deploy note*, Files -> the end of *Build*, Doc -> *Docs to update in the same commit*, "As built:" -> *As built*; the status from the tracker row. A line-by-line check found every old line in its file but for those labels.
- Three kinds of edit beyond the headings: "this one" -> `AUTO-CALLS.md` in the docs lines; an *As built* that pointed "above" at a section now names the doc it is in (T6, T12, T13b); T0 and T3 gained a one-line *As built*, having none.
- The body's real-call notes moved into the ticket whose calls they were: T13 (the first calls' confidence), T13b (how the silence was measured).

---

Standard: `docs/DOCS.md`. Tracker: [`README.md`](README.md). One branch off `dev`, merged `--no-ff`, in one commit.
