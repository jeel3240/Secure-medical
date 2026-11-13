# A15 · Seri books a call back

**Goal:** A call back Seri books is saved, owned by the lead's agent or open to everyone, and its result reads right on every screen.

**Why:** Leads who say "call me tomorrow at 3" must reach a person at 3.

**Depends on:** A07, A08, A14  ·  **Size:** Small (a few hours)  ·  **Status:** Done 2026-11-12

## Build

- In `backend/src/db/callbacks.ts`: `bookAiCallback({ leadId, at, reason, callId })`. The lead's holder, if any, as `agent_id`; otherwise null. Reason `ai_booked`.
- Checked again with `checkCallbackTime` (A07); refused times are a bug, logged.
- **Every query that reads `callbacks` assumed an agent until 022** (found in A08): `WORKED_SQL` (`db/lead-state.ts`) counts any callback as a person having worked the lead - a Seri booking is not, as T4 decided for a robot call nobody took; and the queue joins `callbacks` to `users` (`db/queue.ts`, the Callback tag), which drops a booking with no agent (A16). Admin > Overview counts callbacks per agent, so it already leaves an unowned one out.
- Activity log row.
- The lead's page shows "Callback booked: Thu 3:00 PM" with the reason.
- **The new result, `callback_booked`, everywhere a result is shown:** its words in `frontend/src/lib/call-results.ts` ("Call back booked"), so the timeline line and Admin > Leads' Call column read it; a value of the Call filter (`backend/src/api/admin/leads.ts`, which answers 400 to a value it does not know, and `backend/src/db/leads.ts`).

## Done when

- [x] A live check: held lead gets their agent; unheld lead gets none; the activity row is written - and a lead held by a deactivated account gets none, once per call, not worked, on the lead's page and timeline, the note's rules (`ai-agent-live-check`, 100).
- [x] Admin > Leads filters on `callback_booked`; the timeline and the Call column read "Callback booked" - the app's own word, as My Callbacks and the timeline's "Callback scheduled" have it (`admin-leads-live-check`, 55).

## Tests

- DB live check; route test from A14; the result's words; the filter (`admin-leads-live-check`).

## Docs to update in the same commit

- `docs/AGENT-WORKSPACE.md` callbacks section; `docs/ADMIN-LEADS.md` "Call".

## Where it hooks in (from A14)

- `/auto/ai-after` already saves `callback_booked` and hangs up (`afterSeri` gives `kind: 'end'` with `callback`, her handoff - `at`, `timeZone`, `reason`). Save the call back in the same place: the `end` branch of `afterSeriTwiml` (`api/twilio-webhooks.ts`), once - only for the request that saved the result (`keepCallResult`'s `saved`), as the link is texted once; and for a lead who hung up after she booked it too, since `afterSeri` books it either way.
- `CallResult` already has `callback_booked` (`core/call-script.ts`).

## Not in this ticket

- Showing it in the queue (A16).

## As built

- **Booked with her result, in one transaction:** `keepCallResult` (`db/auto-calls.ts`) takes the booking and calls `bookAiCallback` (`db/callbacks.ts`) only when it saved `callback_booked` - the result and the call back never come apart, and Twilio asking twice books once.
- **Migration 023, beyond the ticket:** `callbacks.note`, her one-line reason - the table had nowhere for it - only on hers and at most 200 characters; and `callbacks_one_per_ai_call`, one per call she booked it on.
- **Whose:** the lead's holder if active; a lead held by a deactivated account gets none, as the queue reads a holder.
- **The re-check:** `checkCallbackTime` against `readCallHours`, in `/auto/ai-after`; a refusal is logged (`auto_call.callback_time_refused`, error) only for a booking made, and it is booked all the same - the lead was told.
- **Recorded:** `callback.booked`, no actor, `via: 'seri'`, `callId`, `timeZone`; the note stays on the callback.
- **On screen:** a navy badge on the lead's page (`aiCallback`, `aiCallbackLabel`) - "Callback booked · Thu, Nov 13 3:00 PM · Wants to order antibiotics"; the timeline's "Callback booked by Seri for ... · her line"; Admin > Leads' "Callback booked". The ticket said "Call back booked": the app writes "Callback" everywhere else.
- **Not worked:** `WORKED_SQL` leaves `ai_booked` out.
- **Tests:** route - the booking passed with her time, line and zone, the refused time logged once (2); the filter value; the words and the badge (frontend 413); live checks above. 1,598 backend tests, all 23 live checks.
- **Seen on the real API:** two bookings through `/auto/ai-after` - open to everyone and Maya's - a repeat booking nothing, read back signed in on the lead's page, its timeline and Admin > Leads filtered.
- **Applied locally:** migration 023 on the local database, since the local API runs the source.

Design: `docs/AI-AGENT.md`. All AI code in `backend/src/ai/`. One PR into `dev`.
