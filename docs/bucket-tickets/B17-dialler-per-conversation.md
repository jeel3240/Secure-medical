# B17 · The dialler per conversation

**Goal:** the robot calls a person for a new bucket when that bucket's conversation is
due - whatever happened in an earlier bucket.

**Why:** decision 4, Jeel 2026-11-27: a new bucket counts as a new lead, with its own
robot call. Today `leadsToCall` and `stillDue` (`backend/src/db/auto-dial.ts`) skip a
lead with **any** disposition, note or agent call ever (`WORKED_SQL`), any reply ever,
any robot call ever (`calls_one_automated_per_lead`, `automatedCallUsedSql`), or a lead
row older than 30 days; T27's "new leads first" uses the lead's age.

**Depends on:** B15 · **Size:** M · **Status:** To do · **Deploy note:** a migration
that only drops an index, after the code stops relying on it.

## Build

- `backend/src/db/lead-state.ts`: `workedSinceSql(since)` - "worked" (a holder now, a
  note, a non-Seri callback, a disposition, an agent call, an agent text) counted from
  `since`. `WORKED_SQL` stays for what still means "ever".
- `leadsToCall` and `stillDue`, for the newest conversation `c`:
  - open, its first question out at least the wait ago - as today;
  - `c.created_at` within the 30 days, not `l.created_at`;
  - nobody holds the lead now - as today;
  - not worked since `c.created_at`; no text or call from the lead since
    `c.created_at`;
  - no robot call used **for this conversation**;
  - T27's order on `c.created_at`, not the lead's.
- `backend/src/db/auto-calls.ts`: `automatedCallUsedSql` and `NOT_PLACED_LIMIT` per
  conversation; `startAutomatedCall`'s check under the lock likewise.
- A migration dropping `calls_one_automated_per_lead`; B15's per-conversation index is
  the guard from now on.

## Done when

- [ ] `scripts/auto-dial-live-check.ts`, new section "a new bucket": a lead closed
      as Sold in conversation 1, with conversation 2 texted an hour ago and no reply,
      is picked; one who replied in conversation 1 but not 2 is picked; one who replied
      in 2 is not; one already called for 2 is not; three `not_placed` for one
      conversation use it up, not the lead's next; the 30 days and T27's order counted
      from the conversation. Every existing section unchanged.
- [ ] `scripts/auto-calls-live-check.ts`: two placements racing for one conversation
      write one row, with the per-lead index gone.
- [ ] `src/worker/auto-calls.test.ts` unchanged and passing.

## Tests

The two live checks; the unit tests as they are.

## Docs to update in the same commit

`docs/AUTO-CALLS.md` ("Who is called", "Traffic", T27's note), `docs/SCHEMA.md` (the
dropped index), `CLAUDE.md` §5, `docs/WORKFLOW.md`, `docs/BUCKETS.md`.

## Not in this ticket

Robot calls switched per bucket, and a per-bucket switch-on time (B34).

## As built

*Empty until the ticket is done.*

---

Design: `docs/BUCKETS.md`. Tracker: [`README.md`](README.md) - its rules and gates apply to every ticket. One branch off `dev`, merged `--no-ff`, code, tests and docs in one commit.
