# D31 · DESIGN-PROMPT.md restored

**Goal:** `DESIGN-PROMPT.md` reads as the brief was written, with one note at the top.

**Why:** `DOCS.md`, "Brief": kept as it was, not updated (audit, 2026-11-27).

**Depends on:** D30 · **Size:** S · **Status:** To do · **Deploy note:** none - documentation only.

## Build

- the text restored from git - the 2026-09-14 version with section 6g (`bdb51be`), the original being `7925be4` - checked that nothing in it is lost that D30 did not carry; the note at the top: what this is, and that `FRONTEND.md` and the area docs say what was built.

## Done when

- [ ] `git diff` against `bdb51be` shows only the top note;
- [ ] every note removed was carried by D30 - the list in *As built*.

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
