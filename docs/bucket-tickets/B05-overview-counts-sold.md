# B05 · Overview counts sold

**Goal:** Admin > Overview shows how many leads were **sold** in the period, overall
and per agent, beside Closed.

**Why:** the reason B04 saves makes it countable; the app cannot say today
(`BUCKETS.md`, "A closed lead joins a new bucket").

**Depends on:** B04 · **Size:** S · **Status:** Done 2026-11-28 - the admin live check's
sold section, the frontend tests and the speed check · **Deploy note:** none, no
migration.

## Build

- `backend/src/db/admin-overview.ts`, `getOverview`: in the KPI query, `sold` - the
  distinct leads with a disposition in the period whose `reason = 'sold'`, or whose
  `value` is the retired `sold` from before 2026-09-28; in the agents query, `sold` per
  agent, the same rule.
- The response type and `frontend/src/api/admin.ts` gain `sold`.
- `frontend/src/pages/admin/OverviewPage.tsx`: a "Sold" card after "Closed", and a Sold
  column in the agents table.

## Done when

- [x] `scripts/admin-live-check.ts`: a reason `sold` counts; the retired value `sold`
      counts; `not_interested`, `wrong_number` and no reason do not; only inside the
      period, in the viewer's time zone; per agent.
- [x] Frontend test: the card and the column.
- [x] `npm run speed`: the Overview timing no slower - numbers in *As built*.

## Tests

The live check; the frontend test; the speed check.

## Docs to update in the same commit

`docs/ADMIN.md` (Overview); `docs/FRONTEND.md`.

## Not in this ticket

A bucket filter on Overview; any other new statistic.

## As built

- **The rule's words in core:** `SOLD_REASON` and `RETIRED_SOLD` in
  `core/dispositions.ts`, typed against `CLOSE_REASONS` and `RETIRED_DISPOSITIONS`;
  `sold(d)` in `db/admin-overview.ts` builds the SQL from them.
- **One pass, not two more.** Written as two more subqueries - one for the total,
  one per agent - Overview at 50,000 leads went from 25 ms to 29 ms (three rounds,
  old and new alternating on one loaded database: 25.6 / 29.0, 23.9 / 29.2, 24.8 /
  29.7). Closed and sold now come from one pass over the period's outcomes with
  `FILTER`: a subquery `outcomes` for the totals, a `CROSS JOIN LATERAL` per agent.
  Then 24.5 / 23.8, 24.2 / 24.9, 24.0 / 24.4; the full speed check 25.4 ms before,
  24.1 ms after.
- **The speed check's outcomes** carry a reason - Sold, Not interested and Wrong
  number in turn - and their conversation, as the app writes them since B04.
- **The live check** runs every sold check in the viewer's zone, Phoenix, with one
  sale a minute before its midnight and one a minute after; six checks failed on
  the old query.
- **The frontend:** `overviewStats` (exported, tested) lists the five totals;
  `.stats` became one row of as many columns as totals (`grid-auto-flow: column`),
  where it was four fixed. The column is proved by a render test of the page with
  its API mocked (`OverviewPage.render.test.tsx`). Not looked at in a browser.

---

Design: `docs/BUCKETS.md`. Tracker: [`README.md`](README.md) - its rules and gates apply to every ticket. One branch off `dev`, merged `--no-ff`, code, tests and docs in one commit.
