# D46 · REVIEW-2026-11-22.md

**Goal:** The review is one findings table - id · what · where · status - after a one-paragraph lead.

**Why:** Five tables with different columns, a legend, "Found fine" as a section, statuses as long sentences (audit, 2026-11-27).

**Depends on:** D01 · **Size:** S · **Status:** Done 2026-11-27 - one findings table after the lead, all 85 findings kept with their status; `--type review` passes · **Deploy note:** none - documentation only.

## Build

- one table; statuses `Fixed YYYY-MM-DD - branch` or `Decided YYYY-MM-DD - see <doc>`; "Found fine" as a lead sentence; D1 and D2's decision text linked to `WEBHOOKS.md`/`QUEUE.md`.

## Done when

- [ ] every finding kept, with its status;
- [ ] the doc's shape is `DOCS.md`'s Review.

## Tests

The docs check (D47) once it exists; until then `grep` for every name the doc gives, and each link opened.

## Docs to update in the same commit

`docs/README.md`'s table if a doc is added, renamed or its type changes; the tracker's row.

## Not in this ticket

Rewriting any other doc - each has its own ticket.

## As built

- Lead paragraphs: what was reviewed and how, what the id letters and kinds mean, and "Found fine". Then one table - Id · What · Where · Status - for all 85 findings (2 D, 13 H, 42 M, 16 R, 12 Q).
- Each fix moved into What after "**Fix:**"; statuses are `Fixed YYYY-MM-DD - <branch>` or `Decided 2026-11-23 - see <doc>`; D1 and D2 link `WEBHOOKS.md` and `QUEUE.md` for the decision text; R10's struck-through text rewritten.

---

Standard: `docs/DOCS.md`. Tracker: [`README.md`](README.md). One branch off `dev`, merged `--no-ff`, in one commit.
