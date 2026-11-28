# D44 · Phase 7's tracker aligned

**Goal:** `ai-agent-tickets/` uses the fixed words and sections, without restructuring finished tickets.

**Why:** No "Waiting on"; size L used; statuses outside the fixed words (A21 still Paused, A23 "Later", A22 "In progress"); A21 and A22 lack Status lines; A22 depends on A21 where the tracker says A34 (audit, 2026-11-27).

**Depends on:** D01 · **Size:** S · **Status:** Done 2026-11-27 - every ticket's Depends/Size/Status in one form; the tracker in `TRACKER.md`'s sections · **Deploy note:** none - documentation only.

## Build

- the statuses in the fixed words (A21 `Dropped 2026-11-17 - walked again as A34`; A23 `Waits on A22`); "Waiting on" and a decisions paragraph added; "Order" renamed "The order"; a note that L predates the standard;
- every ticket's Depends/Size/Status line in one form; A21's and A22's Status lines; A22's dependency fixed.

## Done when

- [ ] the tracker's sections match `TRACKER.md`;
- [ ] every ticket has one Depends/Size/Status line in the same form.

## Tests

The docs check (D47) once it exists; until then `grep` for every name the doc gives, and each link opened.

## Docs to update in the same commit

`docs/README.md`'s table if a doc is added, renamed or its type changes; the tracker's row.

## Not in this ticket

Rewriting any other doc - each has its own ticket.

## As built

- Every ticket's line is `**Depends on:** ... · **Size:** S|M|L · **Status:** <fixed words>`: "nothing" to `-`, the sizes to their letters, a Done's evidence added where it had none; A21 `Dropped 2026-11-17 - ... walked again on it as A34`, A22 `In progress` and depending on A34 (was A21), A23 `Waits on A22` - its "decided by Jeel, 2026-11-16" moved into its Why.
- The tracker: "The rules every ticket keeps", "The tickets" with group rows, "The order" (was "Order"), "Waiting on", "The decisions these tickets build on"; a note that L predates the standard, and a map of where the old `AI-AGENT.md` sections went, so finished tickets keep their pointers as written.
- A23, still open, re-pointed to `AUTO-CALL-SCRIPT.md` and `QUEUE.md`, "The tag", its checks moved from the removed answer test set to the understand set and the policy; the new brain's `machine` label noted.
- Finished tickets were not restructured.

---

Standard: `docs/DOCS.md`. Tracker: [`README.md`](README.md). One branch off `dev`, merged `--no-ff`, in one commit.
