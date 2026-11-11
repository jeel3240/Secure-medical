# A16 · Seri's call backs in the queue

**Goal:** When a call back Seri booked is due, every agent sees it at the top of the queue; overdue ones stay there.

**Why:** A booked call back nobody sees is a lost lead.

**Depends on:** A15  ·  **Size:** Medium (about a day)

## Build

- `backend/src/db/queue.ts` and `backend/src/core/queue-tags.ts`: a lead with an open `ai_booked` callback due now or overdue shows **Callback · 3:00 PM** and ranks with Missed call at the top.
- An `ai_booked` callback with no agent is visible to everyone; the first agent to open the lead claims it and the callback becomes theirs.
- My Callbacks (`frontend/src/pages/CallbacksPage.tsx`) lists it for its agent once claimed.
- Not due yet: the lead is not pushed up.

## Done when

- [ ] Queue live check: before due, at due, overdue, claimed.
- [ ] Speed check (`npm run speed`) still under its limits.

## Tests

- Queue live check; frontend tag test.

## Docs to update in the same commit

- `docs/QUEUE.md` "The order" and "The tag".

Design: `docs/AI-AGENT.md`. All AI code in `backend/src/ai/`. One PR into `dev`.
