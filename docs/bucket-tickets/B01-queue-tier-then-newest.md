# B01 · Queue: tier first, then newest

**Goal:** after the promised calls, the agents' queue lists HOT leads newest first,
then WARM newest first, then LOW newest first, then any lead with no tier.

**Why:** decided by Jeel, 2026-11-27 (`QUEUE.md`, "The order", the "decided, not
built" note). Score first keeps a HOT 90 that has waited five days above a HOT 85
that arrived two minutes ago; speed to contact is what the score is for. Not bucket
work - built on its own.

**Depends on:** - · **Size:** S · **Status:** To do · **Deploy note:** none, no
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

- [ ] `scripts/queue-live-check.ts`: the "score desc then freshest" checks are
      replaced by an "order: tier first, then newest" section - a HOT 85 from two
      minutes ago above a HOT 90 from five days ago; every HOT above a newer WARM;
      WARM above LOW; a lead with no tier after LOW; a missed "yes" and a due call back
      still first; two identical rows ordered by id.
- [ ] `frontend/src/pages/QueuePage.test.ts`: both `orderText` wordings.
- [ ] `npm run e2e`: step 3's "at the top" still holds, or is changed with the reason
      in *As built*.
- [ ] `npm run speed -- 50000`: the queue's timings (open, one tier, search, 7 days)
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

*Empty until the ticket is done.*

---

Design: `docs/BUCKETS.md`. Tracker: [`README.md`](README.md) - its rules and gates apply to every ticket. One branch off `dev`, merged `--no-ff`, code, tests and docs in one commit.
