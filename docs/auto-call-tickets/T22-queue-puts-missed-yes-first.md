# T22 · The queue puts a missed "yes" first

**Goal:** a lead who said yes and reached nobody is the next one an agent
calls.

**Depends on:** T15a · **Size:** - · **Status:** Done 2026-10-24 - seen in the
browser: two "yes" leads nobody took at the top, Wants a call, above a 100-point lead
· **Deploy note:** none until robot calls exist.

## Build

- A lead whose robot call ended `transfer_missed` is in the queue, at the
  top, tagged "Wants a call".
- It stays until an agent calls it, texts it, or saves an outcome - as a
  missed call does.
- One shared definition in `db/lead-state.ts`, used by the queue.

**Files:** `backend/src/db/lead-state.ts`, `backend/src/db/queue.ts`,
`backend/src/db/lead-detail.ts`, `backend/src/core/queue-tags.ts` (+ test),
`backend/src/api/__tests__/lead-detail.test.ts`,
`backend/scripts/queue-live-check.ts`, `backend/scripts/lead-detail-live-check.ts`,
`backend/scripts/speed-check.ts`, `frontend/src/api/workspace.ts`,
`frontend/src/pages/WorkspacePage.tsx`, `frontend/src/pages/QueuePage.tsx` (+ test),
`frontend/src/components/QueueStatus.tsx`.

## Done when

- [x] A live check: in the queue, at the top; gone after an agent's call,
      text or outcome. Through the real writes - the robot's call, nobody
      taking it, an agent's call, an outcome: first, before a 90-point lead,
      the longest waiting on top; Wants a call with no score; on the lead
      card; a robot call that ended any other way puts nobody in; an
      automated text, or an agent's EZ Texting refused, does not clear it;
      picked up, Working and still first (`queue-live-check`, 70). Unit tests:
      the tag's rank - above an unread reply, a callback and needing review,
      below Working and a missed call (1,026 backend tests); the page's words
      with automated calls on and off (376 frontend tests).
- [x] `npm run speed`: the queue still loads quickly with 50,000 leads -
      faster: 96 ms before, 75 ms after (`QUEUE.md`, "How fast it is").
- [x] Seen in the browser, 2026-10-24, Jeel: leads 48 and 51 - real calls
      that ended "said yes · nobody took it" - first in the local queue, the
      older on top, Wants a call, above a 100-point lead; lead 51's card
      flagged `missedYes`. Both were made before `dev-auto-call` gave a test
      lead its text conversation, which every real lead has and the queue
      reads; they were given one by hand, in the local database.

## Docs to update in the same commit

`QUEUE.md`; `AUTO-CALLS.md`; `AGENT-WORKSPACE.md`, `FRONTEND.md`,
`LEAD-FLOW.md`, `DESIGN-PROMPT.md`, `README.md`, `CLAUDE.md`.

## As built

`QUEUE.md`, "Who is in it", "The order" and "The tag". Beyond the
ticket: **the lead card says it too** - a Wants a call badge
(`flags.missedYes`), since the queue says only Working once the lead is picked
up; **the tag ranks with the missed call**, just below it and above an unread
reply - the lead was promised a call back; **the page states the order**,
"Missed transfers first, then highest score, then newest.", only while
automated calls are on (with Seri's due call backs named since 2026-11-23,
`QUEUE.md`, "The order"); and **the rule is the missed call's**, one
`nobodyGotBackSince` in `db/lead-state.ts`. Written against the call's own
lead, it lets Postgres work out both once per refresh rather than once per
lead, so the queue got faster though it asks more (122 ms in the first
version) - and Admin > Leads with it, through "Closed". The speed check now
loads robot calls. A missed "yes" has no tier, so it shows under All only.

---

Design: `docs/AUTO-CALLS.md`, `docs/AUTO-CALL-SCRIPT.md`, `docs/AUTO-CALL-TRANSFER.md`. Tracker:
[`README.md`](README.md). One branch off `dev`, one PR into `dev`, with its code, tests and
doc lines.
