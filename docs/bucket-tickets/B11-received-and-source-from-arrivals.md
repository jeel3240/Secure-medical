# B11 · "Received" and "Source" from arrivals

**Goal:** a lead's "Received" date and its "Source" come from its newest arrival, so a
person who comes back for a new bucket counts as new today.

**Why:** decision 3, Jeel 2026-11-27 (`BUCKETS.md`): "Received" is the newest arrival.
Today it is `leads.ezt_added_at` through `RECEIVED_SQL` (`backend/src/db/lead-state.ts`)
and its copy `ARRIVED_AT` (`backend/src/worker/send-waiting-openers.ts`); the source is
`leads.source`.

**Depends on:** B10 · **Size:** M · **Status:** To do · **Deploy note:** none.

## Build

- `db/lead-state.ts`:
  - `RECEIVED_SQL` - the newest arrival's `arrived_at` among arrivals that `started` or
    were `held`, falling back to `leads.created_at` for a lead with none. A re-delivery
    to someone mid-flow (`mid_flow`), a block or a wrong number does not make them
    "new";
  - `SOURCE_SQL` - that same arrival's `source`.
- Every reader moves to them, no copies (`grep`):
  - `send-waiting-openers.ts` - `ARRIVED_AT` deleted, `RECEIVED_SQL` used;
  - the queue (`db/queue.ts`: the source filter, counts and list);
  - Admin > Leads (`db/leads.ts`: the filter, the row, `listLeadSources` - the distinct
    sources of arrivals);
  - the lead card (`db/lead-detail.ts`);
  - My Callbacks (`db/callbacks.ts`);
  - Overview (`db/admin-overview.ts`), the retry (`db/openers-never-sent.ts`).
- Indexes: whatever the speed check shows the new reads need (the arrival index from
  B09 first); `idx_leads_received` (013) stops being used - dropped in B13, not here.
- `scripts/speed-check.ts`: arrivals in its load (B10), and no other change.

## Done when

- [ ] `scripts/queue-live-check.ts`, `admin-leads-live-check.ts`,
      `lead-detail-live-check.ts`, `callbacks-live-check.ts`, `admin-live-check.ts`: a
      lead whose newest started-or-held arrival is today reads as received today and
      sorts as new; one with only a `mid_flow` re-arrival keeps its earlier date; a lead
      with no arrival falls back to `created_at`; the source shown and filtered is the
      newest arrival's.
- [ ] `scripts/send-waiting-openers-live-check.ts` passes with `ARRIVED_AT` gone.
- [ ] `npm run speed -- 50000`: every screen's timing before and after, in *As built*.
      If the queue or Admin > Leads is more than 20% slower, stop and bring the numbers
      to Jeel before merging.

## Tests

The live checks above and the speed check.

## Docs to update in the same commit

`docs/QUEUE.md` (what "Waiting" counts from), `docs/ADMIN-LEADS.md` ("Received",
"Source"), `docs/AGENT-WORKSPACE.md` (the card's age and source), `docs/ADMIN.md`
(Overview's count), `docs/POLLER.md` (the resend's window), `docs/LEAD-FLOW.md`,
`docs/BUCKETS.md`.

## Not in this ticket

The timeline's "received" events (B12); dropping the old columns (B13).

## As built

*Empty until the ticket is done.*

---

Design: `docs/BUCKETS.md`. Tracker: [`README.md`](README.md) - its rules and gates apply to every ticket. One branch off `dev`, merged `--no-ff`, code, tests and docs in one commit.
