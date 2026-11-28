# B19 · Closed and "worked" per conversation

**Goal:** a Closed applies to the conversation it closed, so a new bucket reopens the
person; and Admin > Leads reads "worked" for the current bucket only. Closed's reason
becomes required.

**Why:** decisions 4 and 5, Jeel 2026-11-27 (`BUCKETS.md`, "A closed lead joins a new
bucket"). Today `CLOSED_SQL` (`backend/src/db/lead-state.ts`) takes the lead's newest
disposition whatever came after, and `STATUS_SQL` (`backend/src/db/leads.ts`) ranks
"Working" from any work ever - a lead sold in antibiotics would read Closed, or
Working, from weight loss's first text on.

**Depends on:** B04 · **Size:** S · **Status:** To do · **Deploy note:** the deploy
after B04's - old browsers have reloaded by then, and the old code that saved
outcomes without a conversation has stopped.

## Build

- A migration that fills in `dispositions.conversation_id` where it is still null on
  a lead that has a conversation, by 025's rule: the newest conversation started at
  or before the outcome. On 025's deploy the old code, running between `migrate` and
  `up`, saved outcomes without it (`AGENT-WORKSPACE.md`, "Dispositions"); read as
  they are, those leads would come back into the queue. It stops, changing nothing,
  if one is still left without one - 025's guard.
- `CLOSED_SQL`: the newest disposition counts only when its `conversation_id` is the
  lead's newest conversation - or both are null, for a lead with no conversation. A
  new bucket's conversation - started only for Sold, Not interested, or no reason
  (B22) - therefore reopens the person; a wrong number never starts one, so stays
  closed. The four existing ways a closed lead reopens are
  unchanged.
- `STATUS_SQL`: "worked" since the newest conversation began - `workedSinceSql`
  (B17; whichever ticket is built first adds it to `lead-state.ts`).
- `backend/src/api/lead-workspace.ts`: Closed with no reason is now 400
  `reason_required`.

## Done when

- [ ] An upgrade check: migrated to the last migration before this one, an outcome
      seeded with `conversation_id` null on a lead with a conversation - filled in
      with the right one; one on a lead with none - left null; every other row
      unchanged.
- [ ] `scripts/queue-live-check.ts`: closed in conversation 1, then conversation 2
      started - in the queue by conversation 2's rules, like a new lead; closed in the
      newest conversation - out, as today.
- [ ] `scripts/admin-leads-live-check.ts`: that lead reads conversation 2's status
      (e.g. Awaiting reply), not Working or Closed.
- [ ] Route test: `reason_required`.
- [ ] `scripts/dispositions-live-check.ts` and `npm run e2e` pass with a reason always
      sent.

## Tests

The upgrade check, the live checks, the route test, the e2e.

## Docs to update in the same commit

`docs/SCHEMA.md` (`dispositions.conversation_id` - no longer null from a deploy),
`docs/ADMIN-LEADS.md` ("Closed": what reopens a closed lead; Working and
Closed), `docs/QUEUE.md` ("Who is in it" links it), `docs/AGENT-WORKSPACE.md`
(the reason is required), `docs/LEAD-FLOW.md`, `docs/BUCKETS.md`.

## Not in this ticket

Deciding whether a new bucket starts (B22).

## As built

*Empty until the ticket is done.*

---

Design: `docs/BUCKETS.md`. Tracker: [`README.md`](README.md) - its rules and gates apply to every ticket. One branch off `dev`, merged `--no-ff`, code, tests and docs in one commit.
