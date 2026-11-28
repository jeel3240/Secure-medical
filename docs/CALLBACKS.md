# Callbacks

A callback is a promise to ring a lead back at a time: booked by an agent, by the
system for the agent a missed call rang, or by Seri on the automated call. My
Callbacks is where each agent sees theirs - today's, upcoming and overdue - and
where a superadmin sees anyone's. The code is `backend/src/db/callbacks.ts` and
`backend/src/api/callbacks.ts`, with booking on a lead in
`backend/src/api/lead-workspace.ts`; the screen is
`frontend/src/pages/CallbacksPage.tsx` (brief: `DESIGN-PROMPT.md` section 5).

## How it works

### Endpoints

Creating a callback belongs to a lead, so it is on the leads router; the rest
belong to the agent.

| Method | Path | Does |
|---|---|---|
| `POST` | `/api/leads/:id/callbacks` | `{ scheduledAt, agentId? }` - books one, for you by default; a superadmin may book one for another active agent (403 `forbidden` for anyone else; 400 `invalid_agent_id` for no such active agent). Needs the caller to hold the lead (`AGENT-WORKSPACE.md`, "Every write needs the lead to be yours"). 201 with the callback |
| `PATCH` | `/api/callbacks/:id` | `{ scheduledAt }` to reschedule, `{ done: true }` to complete, or both; `{ done: false }` reopens a done one. 400 `nothing_to_change` for neither, `invalid_done` for a `done` that is not true or false, `invalid_scheduled_at` for a time that is not ISO. 403 `not_yours` for someone else's ("Whose callback it is") |
| `GET` | `/api/callbacks?when=today\|upcoming\|overdue\|all&agentId=&tz=` | My Callbacks. `when` defaults to `today` (400 `invalid_when` otherwise). `tz` is the viewer's IANA zone, for where today ends - 400 `invalid_tz` for one that is not, UTC when absent. `agentId` is superadmin only: an agent's id, or `all` for every agent's (403 `forbidden` for an agent who sends it) |

### Three kinds

`callbacks.reason` says why a callback exists (`SCHEMA.md`):

| `reason` | Booked by | Whose | Finished by |
|---|---|---|---|
| `booked` | A person, from Wrap up | The booker, or the agent a superadmin booked it for | A person marking it done, or an outcome |
| `missed_call` | The system, when a lead rings and the agent it rang does not pick up (`finishCall`, `db/calls.ts`; `INCOMING-CALLS.md`, "A missed call") | The agent it rang | Anyone getting back to the lead - calling or texting them, or answering when they ring again - or an outcome |
| `ai_booked` | Seri, at a time the lead picked on the automated call ("Seri's call backs") | The lead's own agent, or nobody until someone takes it | Being marked done, or an outcome |

Several callbacks on one lead are allowed - an agent who rings and misses may book
another, and the timeline shows the sequence. An outcome - Closed or DNC - marks
every open callback on the lead done, in the same transaction
(`AGENT-WORKSPACE.md`, "Closing a lead"); one booked after closing reopens the lead
(`ADMIN-LEADS.md`, "Closed").

### My Callbacks: the tabs

The tabs are windows on one column, `scheduled_at`, among callbacks not done
(`done_at IS NULL`). A fourth, **All**, shows every callback, done ones included,
with a Done mark:

| Tab | Holds |
|---|---|
| Today | From now until the viewer's midnight tonight - plus any missed call's callback booked today |
| Upcoming | Tomorrow onwards |
| Overdue | In the past, still not done - except a missed call's callback from today |

- **Days are the viewer's.** The browser sends its time zone as `?tz=`, and Today
  and Upcoming split at that zone's midnight - their real midnight on the two days
  a year the clocks change too, worked out on their own clock
  (`startOfTomorrowSql`, `db/sql.ts`). `scripts/callbacks-live-check.ts` proves
  11:59 PM local is today and 12:01 AM local is upcoming.
- **Today is the rest of today, not the whole day.** A callback booked for 9 AM and
  still open at 3 PM is overdue, not today. Counting it under both would let an
  agent clear the Today tab while the call they missed sits unmade - the tab's job
  is to say what is still ahead of them.
- **A time in the past is accepted.** It arrives straight into Overdue, which is
  what the screen is for; refusing it would leave an agent logging a call they
  agreed to for an hour ago nowhere to put it.
- **Counts come back for every tab, whichever tab was asked for,** so the overdue
  badge is right while the agent is looking at Today. The `all` count includes done
  callbacks.
- **Marking a done callback done again leaves the original `done_at`** - that
  timestamp is when the work happened, and a double click should not rewrite it.
  Rescheduling does overwrite - that is the point of it - and the activity log keeps
  the time it had (`callback.rescheduled`, with `from` and `to`; `AUDIT.md`).

### A missed call's callback

When a lead rings our number and the agent it rang does not pick up, the server
books that agent a callback due at that moment, `reason = 'missed_call'` - one open
per lead. My Callbacks shows it as **Missed call** rather than Overdue, **under
Today**: it is due the second it is booked, so by the rule above it would be
overdue at once and never be on the tab an agent opens. Its time has passed, and
the list is in time order, so it is first under Today. It moves to Overdue only
when the day ends.

It is marked done when anyone calls or texts the lead back, or answers when they
ring again (`finishMissedCallCallbacks`) - the same three things that clear the
queue's Missed call tag. A lead who rings several times is still one callback: it
reads **Missed 3 calls** and shows the time of the latest, both read from `calls`
rather than written onto the callback, so the first call's time is not overwritten
(`missedCalls`). A call that rang everyone free books none (`INCOMING-CALLS.md`).

### Seri's call backs

When the lead picks a time with Seri on the automated call, `/auto/ai-after` books
it with her result, `callback_booked`, in one transaction (`bookAiCallback`,
`keepCallResult`): `reason = 'ai_booked'`, the call it was booked on
(`booked_by_call_id`), and her one-line reason for whoever calls - `note`, "Wants
to order antibiotics". It is **the lead's own agent's** when an active one holds
the lead; otherwise it has **no agent** - open to everyone until someone takes it.
One per call: Twilio asking twice books once. Its time is checked again against
the agents' hours; a refusal there is a bug - the relay checked it before she could
book - so it is logged (`auto_call.callback_time_refused`) and booked all the same,
since the lead was told someone would call then. It is recorded as
`callback.booked`, the system's doing, `via: 'seri'`, with the call and the lead's
zone; the note stays on the callback, never in the log. How she agrees the time
with the lead is `AI-AGENT.md` section 4.

- **On the lead's page**, while it is open: a badge, "Callback booked · Thu, Nov 13
  3:00 PM · Wants to order antibiotics" - in the viewer's own time, then whose it
  is once someone has it, then her line (`aiCallback` on the lead card,
  `aiCallbackLabel`).
- **On the timeline:** "Callback booked by Seri for Thu, Nov 13 3:00 PM · Wants to
  order antibiotics", with no author (`TIMELINE.md`).
- **On Admin > Leads**, the Call column reads Callback booked (`ADMIN-LEADS.md`,
  "Call").
- **Not a person's work:** a lead whose only trace is her booking is not Working
  (`WORKED_SQL`) - no person has been near it, as with a robot call nobody took.
- **Before its time** it changes nothing in the queue; with no score, the lead is
  not in it at all. **Once due**, it puts the lead at the top of the queue,
  "Callback · 3:00 PM" in bold (`QUEUE.md`, "The order"), until it is done. An
  overdue one stays there until someone calls.
- **Who takes it:** while it has no agent, the first agent to pick the lead up -
  "A call back nobody has", below.

### A call back nobody has

A call back is nobody's when it is open and either Seri booked it and no agent has
taken it, or its agent has been deactivated (`nobodysCallbackSql`,
`db/lead-state.ts`).

- **The first agent to pick the lead up takes it.** `claimLead` makes every open
  call back nobody has the picker's, in the same statement as the pick-up, and
  records `callback.taken` for each - with `from`, the deactivated agent it was
  booked for, when there was one. "Took the callback Seri booked for ..." is on the
  lead's timeline. From then it is on their **My Callbacks**, Seri's line in its
  Last note column ("My Callbacks on screen").
- **Put back in the queue,** the lead still sits at the top while a call back of
  Seri's is due, now as "Callback – Maya Chen · 3:00 PM". A later pick-up by someone
  else leaves it with the first.
- **Until someone takes it,** the queue names nobody on it - "Callback · 2:00 PM",
  bold and at the top once due (`PROMISED_CALLBACK_DUE_SQL`); only a superadmin's
  "All agents" view lists it on My Callbacks; and only a superadmin may move it.
- **Nothing is rewritten when someone is deactivated,** as with a lead they held:
  the row still says whose it was, and reactivating them gives it back.
- **One an active agent has stays theirs**, on a pick-up by anyone else.

### Whose callback it is

An agent sees and changes only their own; a superadmin may list another agent's,
or everyone's, and may change any, which is how a callback left by someone off sick
gets moved. A refusal names the owner, so the screen can say who rather than just
no - "This callback belongs to Maya. Only they or a superadmin can change it." A
call back of Seri's that nobody has taken has no owner to name: the refusal says
"Nobody has this callback yet: pick up the lead to take it."

Changing a callback does not need the caller to hold the lead: it is the agent's
own callback, and they may not hold the lead at that moment. Booking one does.

### The list row

Each row carries what the screen shows, so My Callbacks needs one request, not one
per row: the lead's name, phone, source and tier (no score), the lead's newest note
(`latestNote`), who holds the lead now (`holder`, active only - for Pick up, Resume
or View), the callback's `reason` and, on one Seri booked, her `note`, and for a
missed call `missedCalls` - `{ count, lastAt }`. One of Seri's that nobody has taken
has `agentId` null.

### My Callbacks on screen

`/callbacks` (`pages/CallbacksPage.tsx`), in the other list pages' style: one card
with the navy switcher - **Today · Upcoming · Overdue · All**, each with its count -
the old rows kept, faded, through a switch (`FRONTEND.md`, "The polling hook").
Columns: **Due**, **Lead** (the phone under the name), **Tier** (the bars), **Agent**
(only when viewing all agents) and **Last note**, then the action.

- **The row's button follows who holds the lead** (`holder`): **Pick up** when nobody
  holds it, **Resume** to its holder, and **View** to anyone else, which only opens
  the lead read-only, since a claim would be refused (`FRONTEND.md`, "What the button
  offers"). Beside it a "⋯" holds **Reschedule** (the date and time picker,
  `FRONTEND-STYLE.md`, "Picking a date and time") and **Mark done**.
- **An overdue callback says so in amber under its time**, rather than turning the
  row red; a done one, on All, says Done.
- **A missed call** reads **Missed call**, or **Missed 3 calls**, in bold in place of
  Overdue, and shows when they last rang rather than when they first did - that is
  the call being returned.
- **Last note** is the lead's newest note, anyone's; on a call back Seri booked, while
  the lead has no note, her line - "Seri: Wants to order antibiotics".
- **A superadmin's picker is labelled and complete:** **Agent: Me · All agents ·
  nora…**. The title follows it - "My callbacks", "All callbacks", "nora's
  callbacks" - and All agents adds the Agent column, "-" for a call back of Seri's
  that nobody has taken. Agents see no picker.

Wrap up books a callback for whoever saves it: there is no "Assign to" on the
screen, though `POST /api/leads/:id/callbacks` lets a superadmin pass `agentId`
(`FRONTEND.md`, "Differences from the brief").

## Rules

1. **A callback is open until `done_at` is set.** The tabs are windows on
   `scheduled_at` among open ones; All shows the done too.
2. **Days are the viewer's** - `?tz=`, UTC when absent.
3. **Today is the rest of today;** a missed call's callback from today stays under
   Today until the day ends.
4. **A time in the past is accepted.**
5. **Done twice keeps the first `done_at`;** rescheduling overwrites, and the log
   keeps the old time.
6. **An agent sees and changes only their own;** a superadmin anyone's.
7. **A call back nobody has becomes the first picker's,** in the pick-up's own
   statement. One an active agent has stays theirs.
8. **A missed call's callback is finished by the lead being got back to;** a booked
   one only by a person or an outcome; Seri's by being marked done or an outcome.
   An outcome finishes every open one.
9. **Every change is recorded in the same statement** - `callback.booked`,
   `callback.rescheduled`, `callback.done`, `callback.reopened`, `callback.taken`
   (`AUDIT.md`).
10. **A call back Seri booked is no person's work** - not a trace for Working, not
    in Overview's feed or Last active (`ADMIN.md`, "Overview").

## Data

Reads and writes `callbacks` - `reason`, `note`, `booked_by_call_id`, and
`agent_id`, null only on one of Seri's nobody has taken (`SCHEMA.md`); reads
`leads`, the newest `conversations` row for the tier, `notes`, `users` and, for a
missed call's count, `calls`. Each change writes its `activity_log` row.

## Code

| File | What it does |
|---|---|
| `backend/src/db/callbacks.ts` | `createCallback`, `updateCallback`, `listCallbacks` and its windows, `bookAiCallback`, `finishMissedCallCallbacks` |
| `backend/src/api/callbacks.ts` | `GET /api/callbacks`, `PATCH /api/callbacks/:id`; `parseWhen`, `parseScheduledAt` |
| `backend/src/api/lead-workspace.ts` | `POST /api/leads/:id/callbacks` |
| `backend/src/db/claims.ts` | `claimLead` takes a call back nobody has |
| `backend/src/db/lead-state.ts` | `nobodysCallbackSql`, `promisedCallbackDue`, `PROMISED_CALLBACK_DUE_SQL` |
| `backend/src/db/calls.ts` | Books a missed call's callback (`finishCall`) |
| `backend/src/db/auto-calls.ts` | `keepCallResult`, which books Seri's |
| `frontend/src/pages/CallbacksPage.tsx` | My Callbacks |
| `frontend/src/pages/workspace/LeadHeader.tsx` | `aiCallbackLabel`, the lead page's badge |

## Tests

| What | Where |
|---|---|
| The three windows against a real clock; a booked callback whose time has passed is overdue and not also today; 11:59 PM local today, 12:01 AM upcoming; a day the clocks change; completing twice keeps the first time; rescheduling moves a callback between tabs; whose callback it is; the list row; unknown lead, agent and callback | `scripts/callbacks-live-check.ts` |
| The routes: booking for yourself or, as a superadmin, another; listing; reschedule, done, the refusals - Seri's untaken one saying to pick up the lead | `api/__tests__/callbacks.test.ts` |
| A missed call's callback: booked once, under Today, its count and latest time, what finishes it | `scripts/calls-live-check.ts`, `scripts/agent-sms-live-check.ts` |
| Seri's: whose it is, once per call, its record, not Working, on the lead's page and timeline, the note's rules | `scripts/ai-agent-live-check.ts` |
| Seri's and a deactivated agent's in the queue, taken on pick-up, on My Callbacks | `scripts/queue-live-check.ts` |
| Booked, then her call back - a whole call to the agent who picks the lead up | `npm run e2e` - `backend/scripts/end-to-end.ts` |

## Not done

- **The superadmin's All agents list still names the deactivated agent** a callback
  was booked for, though it is nobody's now.
- **The timeline words every taken call back as Seri's.** A deactivated agent's
  call back taken on a pick-up reads "Took the callback Seri booked for ..." -
  `activityText` does not read `from` (`TIMELINE.md`, "Not done").
- **Holidays are not known** to the agents' hours Seri books in (`AI-AGENT.md`
  section 4).

## Decisions

| Decision | By | Date |
|---|---|---|
| My Callbacks in the other pages' style, and a superadmin's picker labelled, with "All agents" to see every agent's callbacks at once | Jeel | 2026-09-28 |
| A missed call books a callback by itself for the agent it rang, shown under Today as Missed call | Jeel | 2026-10-01 |
| A call back Seri books is the lead's own agent's, or open to everyone; once due it is at the top of the queue, and the first agent to pick the lead up takes it | Jeel | 2026-11-11 |
| A deactivated agent's open call backs are nobody's, taken by the first agent to pick the lead up | Jeel | 2026-11-23 |

## History

- 2026-11-27 · Written, from `AGENT-WORKSPACE.md`'s "Callbacks" and `QUEUE.md`'s Seri's call backs and deactivated agents' call backs; the pick-up rule owned here; merged in: My Callbacks on screen from `FRONTEND.md`, and that a missed call's callback is first under Today from the old `TWILIO.md` · docs standard · D21, D26, D38
- 2026-11-23 · A deactivated agent's open call backs are nobody's: no name in the queue, a due one at the top, taken on a pick-up with `from`, on the taker's My Callbacks. Before, one stayed in the deactivated agent's name - on nobody's My Callbacks and not on Overview, a promised call nobody would make unless a superadmin moved it by hand · review D2
- 2026-11-22 · Today and Upcoming split at the viewer's real midnight on the two days a year the clocks change: today's start plus a day was 24 hours on, an hour off it · review M11
- 2026-11-13 · The refusal on a call back of Seri's nobody has taken says to pick up the lead, never "belongs to ." · after A16
- 2026-11-12 · Seri books call backs (`ai_booked`, migration 022, and her `note`, migration 023), shown on the lead's page, its timeline and Admin > Leads, not a person's work; once due, first in the queue and taken by the first agent to pick the lead up, with her line in My Callbacks' Last note column, and "-" in the Agent column for one nobody has taken · A15, A16
- 2026-10-01 · A missed call books a callback for the agent it rang, a row of My Callbacks reading "Missed call" or "Missed 3 calls" under Today, finished when anyone gets back to the lead (migration 008). Rescheduling keeps the old time in the activity log; until then a rescheduled callback kept no trace of it · Jeel, Phase 4
- 2026-09-29 · The list row carries who holds the lead, so the row's button follows it - Resume to its holder, View to anyone else; it had said Pick up on every row, even to the agent already holding it · Jeel
- 2026-09-28 · Today and Upcoming split at the viewer's midnight, from review: they had split at the database's (UTC), so for a call center on US time a 9 PM callback was already "Upcoming", and after 5 PM Pacific the Today tab showed tomorrow's · review
- 2026-09-28 · My Callbacks rebuilt: one card, the navy switcher, the phone under the name, the tier as bars, Pick up beside a "⋯". The superadmin's picker had been an unlabelled select reading "My callbacks" that listed other agents with no way to see everyone's, the title staying "My callbacks" whatever it showed - Jeel: "what is this dropdown?"; the API took `agentId=all` for it. The page's underline tabs, the last of their kind, became the navy switcher · Jeel
- 2026-09-26 · Built: book, reschedule, mark done, list, the three windows - Phase 3 task 7; My Callbacks, task 22
