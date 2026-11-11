# A15 · Seri books a call back

**Goal:** A call back Seri books is saved, owned by the lead's agent or open to everyone, and its result reads right on every screen.

**Why:** Leads who say "call me tomorrow at 3" must reach a person at 3.

**Depends on:** A07, A08, A14  ·  **Size:** Small (a few hours)

## Build

- In `backend/src/db/callbacks.ts`: `bookAiCallback({ leadId, at, reason, callId })`. The lead's holder, if any, as `agent_id`; otherwise null. Reason `ai_booked`.
- Checked again with `checkCallbackTime` (A07); refused times are a bug, logged.
- **Every query that reads `callbacks` assumed an agent until 022** (found in A08): `WORKED_SQL` (`db/lead-state.ts`) counts any callback as a person having worked the lead - a Seri booking is not, as T4 decided for a robot call nobody took; and the queue joins `callbacks` to `users` (`db/queue.ts`, the Callback tag), which drops a booking with no agent (A16). Admin > Overview counts callbacks per agent, so it already leaves an unowned one out.
- Activity log row.
- The lead's page shows "Callback booked: Thu 3:00 PM" with the reason.
- **The new result, `callback_booked`, everywhere a result is shown:** its words in `frontend/src/lib/call-results.ts` ("Call back booked"), so the timeline line and Admin > Leads' Call column read it; a value of the Call filter (`backend/src/api/admin/leads.ts`, which answers 400 to a value it does not know, and `backend/src/db/leads.ts`).

## Done when

- [ ] A live check: held lead gets their agent; unheld lead gets none; the activity row is written.
- [ ] Admin > Leads filters on `callback_booked`; the timeline and the Call column read "Call back booked".

## Tests

- DB live check; route test from A14; the result's words; the filter (`admin-leads-live-check`).

## Docs to update in the same commit

- `docs/AGENT-WORKSPACE.md` callbacks section; `docs/ADMIN-LEADS.md` "Call".

## Not in this ticket

- Showing it in the queue (A16).

Design: `docs/AI-AGENT.md`. All AI code in `backend/src/ai/`. One PR into `dev`.
