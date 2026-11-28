# B04 · Closed asks why

**Goal:** pressing **Closed** in Wrap up opens a popup asking why - **Sold**, **Not
interested** or **Wrong number** - and the reason is saved with the outcome, together
with the conversation it closed.

**Why:** Jeel, 2026-11-27 (`BUCKETS.md`, "A closed lead joins a new bucket"). Since
2026-09-28 Closed stands for sold, not interested and wrong number alike; a new bucket
must know which (B22), and Admin can then count leads sold (B05).

**Depends on:** B03 · **Size:** M · **Status:** Done 2026-11-28 - migration 025, the
live, upgrade, route, frontend and e2e checks pass · **Deploy note:** the route
still accepts a Closed with no reason - a browser still running the old page posts
none until it reloads. B19 makes the reason required, a deploy later.

## Build

- **Migration** (the next free number):
  - `dispositions.reason TEXT`, named checks `dispositions_reason_known`
    (`reason IN ('sold', 'not_interested', 'wrong_number')`) and
    `dispositions_reason_only_closed` (`reason IS NULL OR value = 'closed'`);
  - `dispositions.conversation_id INTEGER REFERENCES conversations(id)`, backfilled for
    every existing row with the lead's newest conversation created at or before the
    disposition (`created_at DESC, id DESC`); a "stops unless" guard: every
    disposition whose lead has a conversation gets one;
  - the header in the house style; no existing value changed.
- `backend/src/core/dispositions.ts`: `CLOSE_REASONS = ['sold', 'not_interested',
  'wrong_number'] as const`, `CloseReason`, `isCloseReason`. These are **new** values in
  a new column, not the retired `RETIRED_DISPOSITIONS` of the same names, which stay
  as they are.
- `backend/src/db/dispositions.ts`, `setDisposition(leadId, agentId, value, reason)`:
  under the lead's lock, in the same statement as today, writes `reason` and
  `conversation_id` (the lead's newest conversation); `outcome.set`'s `detail` gains
  `reason`.
- `backend/src/api/lead-workspace.ts`, `POST /:id/dispositions`: an unknown `reason`,
  or any reason with DNC, is 400 `invalid_reason`; Closed with no reason is still
  accepted (saved NULL) - see the deploy note.
- Frontend:
  - `frontend/src/api/workspace.ts`: `setDisposition` sends `reason`;
    `CLOSE_REASON_LABEL` - "Sold", "Not interested", "Wrong number";
  - `frontend/src/pages/workspace/ActionsPanel.tsx`: choosing Closed opens a `Modal`
    with the three reasons, built like the DNC confirm in the same file; picking one
    selects Closed with that reason; Cancel selects nothing. The chosen chip reads
    "Closed · Sold". Save sends it, as today.
- Shown everywhere Closed is shown:
  - `db/timeline.ts`'s dispositions query returns `reason`; `components/Timeline.tsx`
    reads "Closed · Sold";
  - `pages/LeadTimelinePage.tsx`'s `summarise` list;
  - `db/lead-detail.ts`'s `closed` gains `reason`; `WorkspacePage.tsx`'s badge reads
    "Closed · Sold";
  - Admin > Overview's feed (`OverviewPage.tsx`, `activityText`).

## Done when

- [x] `scripts/dispositions-live-check.ts`: the reason and the newest conversation are
      saved; the two checks refuse a reason on DNC and an unknown reason (an
      `attempt()` helper, naming the constraint); Closed with no reason saves NULL.
- [x] `scripts/dispositions-upgrade-check.ts` (B03): dispositions seeded in the old
      shape - Closed, DNC, the retired values, a lead with two conversations - get the
      right `conversation_id` and a NULL reason.
- [x] Route tests (`src/api/__tests__/dispositions.test.ts`): `invalid_reason` for an
      unknown reason and for DNC with a reason; Closed without one accepted.
- [x] `core/dispositions.test.ts`: `isCloseReason`.
- [x] Frontend tests: Closed opens the popup; Sold then Save sends `reason: 'sold'`;
      Cancel leaves nothing chosen; the timeline and badge wording.
- [x] `outcome.set` carries `reason` (`scripts/activity-live-check.ts`).
- [x] `npm run e2e`: step 8's Closed sends a reason.

## Tests

As above: live check, upgrade check, route and core unit tests, frontend tests, e2e.

## Docs to update in the same commit

`docs/AGENT-WORKSPACE.md` ("Dispositions" - the planned popup moves there from "Not done" - and a History line),
`docs/SCHEMA.md` (the `dispositions` row; the unconstrained-columns table), `docs/WORKFLOW.md` ("Where the files stand"), `docs/AUDIT.md`
(`outcome.set` keeps `reason`), `docs/FRONTEND.md`, `docs/LEAD-FLOW.md` (Wrap up),
`docs/BUCKETS.md` (the decision row: built).

## Not in this ticket

Counting sold on Overview (B05); Closed applying to one conversation in `CLOSED_SQL`
(B19); making the reason required (B19).

## As built

- **Migration 025** (`025_close_reasons.sql`): `reason` with `dispositions_reason_known`
  and `dispositions_reason_only_closed`; `conversation_id` with
  `dispositions_conversation_fk`; the backfill, and a guard that stops - changing
  nothing - when an outcome on a lead with a conversation finds none started at or
  before it. No index on `conversation_id`: nothing reads it yet; B19, which does,
  decides.
- **`setDisposition(leadId, agentId, value, reason = null)`** - the reason is the last
  argument, optional, so the callers that close without one (the queue's live check)
  are unchanged. `conversation_id` comes from `newestConversation` in the same
  INSERT ... SELECT, under the lead's lock. `DispositionRow` gains `reason` and
  `conversationId`; `outcome.set` gains `reason` (null on DNC).
- **The route** accepts `reason: null` as none; any reason with DNC, an unknown word,
  an empty string or a non-string is `invalid_reason`; case and padding are trimmed,
  as for `value`.
- **One label on every screen**: `outcomeLabel(value, reason)` in
  `frontend/src/api/workspace.ts` - the timeline, the Lead Timeline's list, the badge,
  Wrap up's button - and Overview's `activityAfter`, " · Sold" after the lead's name.
  The timeline's detail carries `reason` only when there is one, so older entries are
  unchanged.
- **The popup** is the DNC confirm's `Modal`, titled "Why is this lead closed?", the
  three reasons as `chip-button`s in a `wrapup__choices` group, Cancel in the footer.
  Pressing Closed again once chosen takes it back without asking. Not looked at in a
  browser - Jeel to check it by eye.
- **`refusedBy`** in `scripts/check.ts`: the ticket's `attempt()` helper, moved there
  from `ai-agent-live-check.ts` so both checks share one copy.
- **Seen failing first:** the ten new route tests on the old route; six of the seven
  Wrap up tests on the old panel (the seventh, Closed alone, holds on both).
- **Runs:** every live check (25, both upgrade checks among them); the e2e, 143 checks,
  step 8 saving Sold against the lead's conversation; backend 1,985 and frontend 478
  tests; lint, types, the frontend build, the image build.

---

Design: `docs/BUCKETS.md`. Tracker: [`README.md`](README.md) - its rules and gates apply to every ticket. One branch off `dev`, merged `--no-ff`, code, tests and docs in one commit.
