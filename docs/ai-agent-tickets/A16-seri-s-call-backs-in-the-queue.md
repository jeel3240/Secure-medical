# A16 · Seri's call backs in the queue

**Goal:** When a call back Seri booked is due, every agent sees it at the top of the queue; overdue ones stay there.

**Why:** A booked call back nobody sees is a lost lead.

**Depends on:** A15  ·  **Size:** Medium (about a day)  ·  **Status:** Done 2026-11-12

## Build

- `backend/src/db/queue.ts` and `backend/src/core/queue-tags.ts`: a lead with an open `ai_booked` callback due now or overdue shows **Callback · 3:00 PM** and ranks with Missed call at the top.
- An `ai_booked` callback with no agent is visible to everyone; the first agent to open the lead claims it and the callback becomes theirs.
- My Callbacks (`frontend/src/pages/CallbacksPage.tsx`) lists it for its agent once claimed.
- Not due yet: the lead is not pushed up.

## From A15

- Her bookings are `callbacks` rows with `reason = 'ai_booked'`, `booked_by_call_id`, `note` (her line), and `agent_id` null unless an active agent held the lead (`bookAiCallback`). The lead card already carries the open one (`aiCallback`).
- `db/queue.ts` joins `callbacks` to `users` for the Callback tag (`JOIN users cu ON cu.id = cb.agent_id`), which drops one with no agent; and My Callbacks (`listCallbacks`) lists by agent, so an unowned one appears in neither yet.
- Taking it: `updateCallback` refuses a callback that is not the caller's (`not_yours`) - an unowned one included - so claiming needs its own write, recorded.
- `WORKED_SQL` already leaves her bookings out.

## Done when

- [x] Queue live check: before due, at due, overdue, claimed - and put back, a second agent's pick-up, an outcome (`queue-live-check`, 84).
- [x] Speed check (`npm run speed`) still under its limits - the queue at 50,000 leads 74 ms before, 76 ms after, same data and laptop.

## Tests

- Queue live check; frontend tag test.

## Docs to update in the same commit

- `docs/QUEUE.md` "The order" and "The tag".

## As built

- **In the queue on its own once due:** `AI_CALLBACK_DUE_SQL` in `INCLUDED` (`db/queue.ts`) - no score needed, as with a missed "yes". Before its time it adds nothing.
- **At the top with the missed "yes":** both are a promised call, sorted together on `promised_at` - `LEAST` of when the "yes" call was made and when the call back was due - the earliest first. Not "with Missed call": a missed call sorts by score like any lead, so ranking with it would have left these at the bottom.
- **The tag:** `callback` with `due` (`core/queue-tags.ts`), ranked after a missed call and a missed "yes", before an unread reply - "Callback · 3:00 PM", bold; named once taken. An unowned one not yet due, on a lead in the queue for another reason, reads "Callback · 3:00 PM" in the ordinary place - the next-callback join no longer drops a callback with no agent.
- **Taken on pick-up:** `claimLead` (`db/claims.ts`) updates every open, unowned `ai_booked` callback of the lead to the claimer in the same statement, with `callback.taken` (new action, on the timeline). A transfer or a call back taken in the browser picks the lead up as it rings in, so it takes it too.
- **My Callbacks:** listed for the agent once taken; her line fills the Last note column ("Seri: ...") while the lead has no note - the column is the lead's newest note, anyone's, once there is one. `Callback` carries `note`; `agentId` may be null.
- **Speed check:** its leads now include her call backs - one robot call in twenty.
- **Tests:** tag rules (4), the queue's words and the timeline line (frontend 417), `queue-live-check` 84; 1,602 backend tests, all 23 live checks.
- **Not covered:** a due call back on a lead held by an agent stays at the top under Working - it is that agent's call to make, and the row is locked to others, as a missed "yes" held is.

Design: `docs/AI-AGENT.md`. All AI code in `backend/src/ai/`. One PR into `dev`.
