# B01 · Queue: tier first, then newest

**Goal:** after the promised calls, the agents' queue lists HOT leads newest first,
then WARM newest first, then LOW newest first, then any lead with no tier.

**Why:** decided by Jeel, 2026-11-27 (`QUEUE.md`, "The order", the "decided, not
built" note). Score first keeps a HOT 90 that has waited five days above a HOT 85
that arrived two minutes ago; speed to contact is what the score is for. Not bucket
work - built on its own.

**Depends on:** - · **Size:** S · **Status:** Done 2026-11-28 - the queue live check's
order section, the e2e and the speed check pass · **Deploy note:** none, no
migration.

## Build

- `backend/src/db/queue.ts`, `listQueue`:
  - in the `q` CTE, a `tier_rank` from `tiers.sort_order` (`LEFT JOIN tiers t ON
    t.name = c.tier`) - never a sort on the tier's text, which puts LOW before WARM;
  - **both** ORDER BYs - the page lateral's and the outer one - become
    `promised_at ASC NULLS LAST, tier_rank ASC NULLS LAST, received_at DESC, id DESC`.
    They must stay identical: the inner one picks the page, the outer one orders it;
  - score leaves the ORDER BY; the column stays in the rows;
  - the doc comment on the order (about lines 253-286) rewritten: why tier, not score,
    and where untiered rows go.
- `frontend/src/pages/QueuePage.tsx`: `orderText` - "Missed transfers and Seri's due
  call backs first, then Hot, Warm and Low, newest first." with automated calls on, and
  "Hot, Warm and Low, newest first." with them off; the file's doc comment.
- Nothing else changes: the API shape, the filters, the counts and the tags stay as
  they are.

## Done when

- [x] `scripts/queue-live-check.ts`: the "score desc then freshest" checks are
      replaced by an "order: tier first, then newest" section - a HOT 85 from two
      minutes ago above a HOT 90 from five days ago; every HOT above a newer WARM;
      WARM above LOW; a lead with no tier after LOW; a missed "yes" and a due call back
      still first; two identical rows ordered by id.
- [x] `frontend/src/pages/QueuePage.test.ts`: both `orderText` wordings.
- [x] `npm run e2e`: step 3's "at the top" still holds, or is changed with the reason
      in *As built*.
- [x] `npm run speed -- 50000`: the queue's timings (open, one tier, search, 7 days)
      no slower than before - both sets of numbers in *As built*.

## Tests

The live check above (the order is SQL); the frontend unit test; the e2e and the
speed check as gates.

## Docs to update in the same commit

- `docs/QUEUE.md`, "The order": the order as built, with the reason; the 2026-11-27
  "not built" note turned into "built".
- `docs/DESIGN-PROMPT.md` section 2 ("sorted by score then freshness"): a dated note.
- `docs/AUTO-CALLS.md` and `docs/FRONTEND.md` wherever they quote "Highest score
  first, then newest" (`grep`).
- `docs/QUEUE.md`, Decisions: the tier-first row marked built; `docs/BUCKETS.md`'s pointer to it unchanged.

## Not in this ticket

The tier switcher, the filters and their counts; the Bucket column (B27); the
**Needs review · 2 buckets** tag (B28).

## As built

- **The order, one copy.** `queueOrder(t)` in `db/queue.ts` writes the ORDER BY
  once; the page lateral (`q`) and the outer statement (`page`) both use it.
  `tier_rank` is on `QueueDbRow`; score stays on every row.
- **Not a join on `tiers`.** The ticket said `LEFT JOIN tiers t ON t.name = c.tier`.
  In `BASE` that changed Postgres's plan for the whole statement: the queue as it
  opens went from 83.6 ms to 292.8 ms, one tier from 87.2 to 273.1. The rank is a
  lookup for each queued lead instead - `(SELECT t.sort_order FROM tiers t WHERE
  t.name = c.tier)` - and the timings came back. A comment beside it says why.
- **Speed, 50,000 leads, same laptop** - before / after: as it opens 83.6 / 82.4 ms;
  one tier 87.2 / 82.3; a name search 10.8 / 10.0; the last 7 days 14.5 / 13.0.
  Run against run, alternating old and new code on one loaded database, the two
  were within noise (80-89 ms each).
- **Live check.** The new section, "order: tier first, then newest (B01)", seeds its
  own leads at the end, so the earlier totals and counts are unchanged. Six checks
  failed on the old query and pass on the new: the main order, the order inside a
  tier, the combined filters, the section's order, the HOT 85 above the HOT 90, and
  newest first inside each tier. Every live check passes; the queue's 102.
- **e2e:** step 3's "at the top" holds unchanged; all 142 checks pass.
- **`DESIGN-PROMPT.md` not edited.** The ticket asked for a dated note there, but
  `DOCS.md`, "Brief", keeps the brief as written. The difference is a row in
  `FRONTEND.md`, "Differences from the brief", instead. `AUTO-CALLS.md` and
  `FRONTEND.md` quoted no order line, so nothing there changed besides that row.
- **Also changed:** the comment on `completed` in `core/state-machine.ts` - "Agents
  call, by tier"; the live check's header dropped its drifting check count.
- **Reviewed 2026-11-28, after group A:** the order is SQL by nature - an ORDER BY
  over the database's rows - so it is proved by the queue live check, not by a pure
  function in `core/`; a copy of the rule in TypeScript would test itself, not the
  query. Seen in Chrome on fake leads: Hot, then Warm, then Low, newest first in
  each.

---

Design: `docs/BUCKETS.md`. Tracker: [`README.md`](README.md) - its rules and gates apply to every ticket. One branch off `dev`, merged `--no-ff`, code, tests and docs in one commit.
