# B05 · Overview counts sold

**Goal:** Admin > Overview shows how many leads were **sold** in the period, overall
and per agent, beside Closed.

**Why:** the reason B04 saves makes it countable; the app cannot say today
(`BUCKETS.md`, "A closed lead joins a new bucket").

**Depends on:** B04 · **Size:** S · **Status:** To do · **Deploy note:** none, no
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

- [ ] `scripts/admin-live-check.ts`: a reason `sold` counts; the retired value `sold`
      counts; `not_interested`, `wrong_number` and no reason do not; only inside the
      period, in the viewer's time zone; per agent.
- [ ] Frontend test: the card and the column.
- [ ] `npm run speed`: the Overview timing no slower - numbers in *As built*.

## Tests

The live check; the frontend test; the speed check.

## Docs to update in the same commit

`docs/ADMIN.md` (Overview); `docs/FRONTEND.md`.

## Not in this ticket

A bucket filter on Overview; any other new statistic.

## As built

*Empty until the ticket is done.*

---

Design: `docs/BUCKETS.md`. Tracker: [`README.md`](README.md) - its rules and gates apply to every ticket. One branch off `dev`, merged `--no-ff`, code, tests and docs in one commit.
