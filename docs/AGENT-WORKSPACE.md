# Agent workspace

The API behind an agent's lead page: picking a lead up and letting it go, the rule
that only its holder may act on it, the lead card, marking a reply read, notes, the
two outcomes - Closed and DNC - and the block every DNC path shares, and an
agent's own texts. Callbacks have `CALLBACKS.md` and the timeline `TIMELINE.md`.
The routes are `backend/src/api/leads.ts` (claim, release) and
`backend/src/api/lead-workspace.ts` (every route on one lead), over
`backend/src/db/` - `claims.ts`, `holder.ts`, `lead-detail.ts`, `read-flag.ts`,
`notes.ts`, `dispositions.ts`, `dnc.ts`, `agent-sms.ts`, `failed-sends.ts` - and
`backend/src/core/dispositions.ts` and `core/score-breakdown.ts`. The screen is
`frontend/src/pages/WorkspacePage.tsx` and `frontend/src/pages/workspace/`
(brief: `DESIGN-PROMPT.md` section 3; "The workspace on screen", below).

## How it works

Every route is under `/api`, needs a session, and is open to any signed-in user
unless it says superadmin (`AUTH.md`). Reading a lead needs no claim, so the page
shows any lead and switches its actions off until you pick it; every write needs
the lead to be yours.

### Endpoints

| Method | Path | Does |
|---|---|---|
| `GET` | `/api/leads/:id` | The lead card - "The lead card", below. Read-only: it never clears the unread flag |
| `POST` | `/api/leads/:id/claim` | Picks the lead up. 409 `already_claimed`, naming the holder, when an active agent has it |
| `POST` | `/api/leads/:id/release` | Lets your own claim go; a superadmin may release anyone's. 204; 403 `not_yours` for an agent releasing someone else's |
| `POST` | `/api/leads/:id/read` | Clears `has_unread_inbound`. 204, idempotent |
| `POST` | `/api/leads/:id/notes` | `{ body }`. 201 with the note |
| `POST` | `/api/leads/:id/messages` | `{ body }` - an agent's text, one segment (160). 201; 409 `number_blocked` on a blocked number, 502 `send_failed` when EZ Texting refuses it |
| `POST` | `/api/leads/:id/dispositions` | `{ value, confirmDnc? }` - `closed` or `dnc`. `dnc` also blocks the number and needs `confirmDnc: true`. 201 with the row |
| `GET` | `/api/leads/:id/timeline` | The lead's history - `TIMELINE.md` |
| `POST`, `PATCH`, `GET` | `/api/leads/:id/callbacks`, `/api/callbacks/:id`, `/api/callbacks` | Booking, changing and listing callbacks - `CALLBACKS.md`, "Endpoints" |

`GET /api/leads`, the queue, is `QUEUE.md`.

### Claim and release

`db/claims.ts`. Claiming sets `leads.assigned_to` and `assigned_at`; releasing
clears both. The whole one-agent-at-a-time rule is the WHERE clause of a single
UPDATE - shown here simplified; the statement also locks the row, writes
`lead.picked_up` to the activity log in the same breath (`AUDIT.md`), and takes
any call back nobody has:

```sql
WHERE l.id = $1
  AND (l.assigned_to IS NULL
       OR l.assigned_to = $2
       OR NOT EXISTS (SELECT 1 FROM users u WHERE u.id = l.assigned_to AND u.is_active))
```

- **One statement, not a read then a write.** Checking whether a lead is free and
  then claiming it leaves a gap where both agents see it free. With the condition
  in the UPDATE the database decides: the second agent's statement matches no row.
  A second agent gets 409 `already_claimed` - the caller did nothing wrong,
  someone was first - and sees the row as "Working – name" in the queue.
- **Re-claiming a lead you hold succeeds and leaves `assigned_at` alone.** Opening
  a lead twice is not a new claim, and a time that reset on every open would stop a
  superadmin spotting one held since last week - the only reason the column exists.
  Resuming writes no new pick-up.
- **A claim by a deactivated agent is treated as free**, matching the queue. If
  the two disagreed, a lead would look free in the list and refuse to be taken. A
  pick-up from a deactivated agent records `tookOverFrom`.
- **Lost the race to someone who has let the lead go again since,** a claim is
  tried once more, rather than answer that nobody is working it.
- **A pick-up takes every open call back nobody has** - one Seri booked that no
  agent has taken, or a deactivated agent's - in the same statement, recording
  `callback.taken` for each (`CALLBACKS.md`, "A call back nobody has").
  Re-claiming a lead you hold takes one booked since; a lead someone else holds is
  refused before anything is taken.
- **Taking a call with a lead on it** - the robot's transfer, or a call back that
  rang everyone free - makes the lead follow the call, through the same file
  (`takeCallWithLead`; `AUTO-CALL-TRANSFER.md`, "The transfer").

**A lead stays with the agent who picked it up until they let it go on purpose.**
Two things release it:

- **An outcome.** Saving Closed or DNC releases the lead ("Dispositions").
- **The Release button**, at the top right of the lead's page beside "Held by you ·
  since 3:04 PM". The holder sees it on their own lead. A **superadmin sees it on
  anyone's** - "Held by Maya Chen · since 3:04 PM · Release" - the way out of a
  lead locked to an agent who is not there; the release is recorded as forced. It
  is switched off while a call is under way, a lead's call taken on that page
  included (`mayRelease`, `frontend/src/lib/lock.ts`).

**Back to queue only goes back.** Leaving a page is not a decision about the
lead. A held lead is "Working – name" in the queue, locked to everyone else, and
**Resume** for its holder; a superadmin's button on it is **View**, which opens the
page read-only and claims nothing (`FRONTEND.md`, "What the button offers").
What this costs: nothing releases a lead by itself. An agent who goes home holding
leads keeps them locked until they come back or a superadmin presses Release;
`leads.assigned_at` is how long each has been held.

Releasing a lead nobody holds succeeds: the caller wanted it free, and it is.
Releasing clears who held it and since when, so `lead.released` carries
`heldSince` and whether it was `forced`.

**Claims never expire.** With ten agents who know each other, a timer risks taking a
lead off someone who stepped away, and handing it on by hand is enough.
`assigned_at` is what lets a superadmin tell a lead claimed two minutes ago from one
held since last week. A released lead carries no marker on its row: the release -
who held it, since when, and whether it was forced - is a `lead.released` row in
`activity_log` and a line on the timeline. A lead that is genuinely bad gets an
outcome rather than being released.

### Every write needs the lead to be yours

A note, a new callback, an agent's text, a disposition and marking a reply read are
refused unless the caller holds the lead. `db/holder.ts` answers who holds it;
`requireHolding` in `api/lead-workspace.ts` runs before each write, and before the
body is validated, so a caller who may not act learns nothing from the shape of
the request.

| Caller | Response |
|---|---|
| Holds the lead | Goes ahead |
| Nobody holds it | 409 `not_picked` - "Pick this lead before acting on it." |
| Someone else holds it | 409 `already_claimed` - "{name} is working this lead." |
| No such lead | 404 |

A claim held by a deactivated agent reads as free, matching the claim endpoint.
The functions under the routes - `addNote`, `markLeadRead` - do not check; the
route does. Changing a callback from My Callbacks is guarded differently: it is
the agent's own callback, and they may not hold the lead at that moment
(`CALLBACKS.md`, "Whose callback it is").

### The lead card

`GET /api/leads/:id`, `db/lead-detail.ts` for the query and
`core/score-breakdown.ts` for the words. It carries the name, phone, email,
source, `receivedAt`, the newest conversation, the answer chips, the score
breakdown, the holder (`claimedBy`), `closed`, `aiCallback` and the flags:

| Flag | True when |
|---|---|
| `dnc` | A live `dnc_list` row: no text and no call, ours or the robot's; a note, a callback and picking it up still work |
| `needsReview` | Two unclear replies; the raw messages are worth reading |
| `unread` | An inbound reply nobody has read |
| `expired` | The conversation went quiet past its deadline |
| `missedCall` | The lead rang us, nobody answered, and nobody has got back to them - `MISSED_CALL_SQL` |
| `missedYes` | A "yes" on the automated call nobody took, and nobody has got back to them - the queue's Wants a call (`QUEUE.md`, "The tag"), kept on the card once the lead is picked up and the queue says Working |

- **The newest conversation is the card.** A lateral join picks it, as the queue
  and Admin > Leads do. Earlier ones stay as history; the flags follow the newest,
  so a lead whose old conversation expired but whose new one is open does not read
  as expired.
- **A released `dnc_list` row does not raise the DNC flag** - the join is
  `released_at IS NULL`. A number that opted out and later texted START is
  contactable again; the row is kept only as the record.
- **A claim by a deactivated agent is not reported as a holder,** matching the
  queue and the claim endpoint. All three have to agree, or the card would show a
  lead as held by someone who cannot work it.
- **`closed: { by, at }`** is set while the lead is closed - by the same rule as
  the queue and Admin > Leads (`ADMIN-LEADS.md`, "Closed") - so the page shows
  Closed as the selected outcome, "Closed by Maya · 7:01 PM" under it, and a Closed
  badge. Null for a lead someone holds, so the holder's buttons start clear.
- **`aiCallback`** is an open call back Seri booked: its time, her line, and whose
  it is once taken (`CALLBACKS.md`, "Seri's call backs").
- **One chip per question the lead answered**, with the question's own heading,
  and nothing for a branch they never took. The words are the ones saved with each
  answer (`conversation_answers`), not the choices' current names, so the chips,
  the breakdown and the incoming-call card keep showing what the lead picked after
  a choice is renamed (`STATE-MACHINE.md`, "An answer keeps what it was"). Each
  chip also carries the raw `choice` - `1`, `2` or `3`.
- **The breakdown shows only what was earned.** A lead who stopped after question
  1 gets two lines, not five with zeros. The lines are the answers saved, with the
  label and points each had when given, plus the flow's awards for replying and for
  finishing; an answer's line carries the question's `heading`, shown together -
  "Requested info: Yes  +20" - because "Yes +20" does not say yes to what.
- **`conversation.question`** - "Q2" or "Q1-a" (`core/questions.ts`; `FLOWS.md`,
  "Naming a question") - is which question the lead is on, or stopped at. The
  header's "On Q2", "Stopped at Q1-a" and the incoming-call card read it. A
  conversation whose question cannot be found says only "Open" or "Stopped": the
  position is an order, not a number to print.
- **`conversation.agentTookOverAt` and `phoneTookOverAt`** say when an agent's
  text or a phone call stopped the questions (`STATE-MACHINE.md` rules 2b and 2d).
  The page shows "Agent handling - questions stopped" or "Phone call - questions
  stopped" beside the other badges, and Questions reads "Agent took over at Q1" or
  "Stopped at Q1 by a call" while the conversation is open; once an agent has
  texted, only the agent's, whichever came first.

### Marking a lead read

`POST /api/leads/:id/read`, `db/read-flag.ts`. **Picking a lead marks it read, not
opening it:** the page posts it once the lead is the viewer's and its flag is set
(`WorkspacePage.tsx`). A superadmin glancing at a lead, or an agent looking before
deciding, must not clear the flag - for an expired conversation, or a partway one
an agent took over, the flag is the only thing keeping the lead in the queue
(`db/queue.ts`).

- **Its own endpoint, never a side effect of the `GET`.** The page polls the lead
  every few seconds, so a `GET` that cleared the flag would clear it on the first
  tick whether or not anyone had read the message - and a list that prefetched
  detail would mark leads read that nobody opened.
- **Idempotent.** Marking an already-read lead read is a 204: the caller wanted it
  read and it is. The function reports whether this call was the one that changed
  it, and only then records `reply.read`.
- **Only the holder** - looking at a lead is not handling it.

Saving an outcome clears the flag too ("Dispositions").

### Notes

`POST /api/leads/:id/notes`, `db/notes.ts`, 201 with the note.

- **Append-only.** A note records what an agent thought at a moment, and the
  timeline shows it in sequence; nothing edits or deletes one. `notes` has no
  `updated_at`, which is the schema saying the same thing.
- **The author is the session,** never the payload - a body carrying `agentId` is
  ignored.
- **The body is trimmed, required, and capped at 5000 characters** (400
  `invalid_body`, `body_too_long`). The cap is there so a runaway client cannot fill
  the column, not to ration what an agent can say.
- **Shown in the workspace** ("Notes on the workspace", below), so the agent about
  to call sees them; and on the lead's timeline.

### Dispositions

`POST /api/leads/:id/dispositions`, `db/dispositions.ts` for the write,
`core/dispositions.ts` for the list. Wrap up has two outcome buttons, **Closed**
and **DNC**, then the callback and the note.

- **`closed` and `dnc` are the only values** (`DISPOSITIONS`). The route accepts
  any case and trims, so `  Closed ` stores `closed`; anything else - the retired
  values included - is 400 `invalid_disposition`. `dispositions.value` is plain
  text with no check constraint, so `core/dispositions.ts` is the only thing keeping
  new rows to a known set, and changing it needs no migration. Rows holding retired
  values (`RETIRED_DISPOSITIONS`) stay, and the timeline and Overview still name
  them.
- **What the old outcomes said is covered elsewhere:** a booked callback is its own
  record and on My Callbacks; "no answer" and "voicemail" are a note, and every call
  is a row in `calls` with how it ended (`TWILIO.md`); "interested" is a note or a
  callback; sold, not interested and wrong number are **Closed**, with the note
  saying why.
- **Append-only, like notes.** Nothing updates or deletes a disposition. The
  timeline shows the sequence: a lead closed, reopened by a callback and closed
  again is a different story from one closed once.
- **DNC needs `confirmDnc: true`.** The value alone is 400 `confirm_required`. The
  screen puts a confirm dialog in front of it; the same guard sits on the API,
  because the block is lifted only by a START from the lead and a mis-typed request
  should not be able to set it. Closed needs no confirmation.
- **Still yours as it is saved.** The route checks the lead is yours, then the
  outcome is written in its own transaction with the lead row locked: an outcome on
  a lead another active person now holds is refused - 409 `not_yours`, nothing
  saved - so a release and someone else's pick-up in between cannot let one agent's
  outcome release another's claim and close their call backs.

#### Closing a lead

**Closed finishes the lead.** It leaves the queue and reads Closed on Admin > Leads
(`ADMIN-LEADS.md`, "Closed", which owns what reopens it). `CLOSING_DISPOSITIONS` is
the list - `closed`, and the retired `sold`, `not_interested` and `wrong_number`, so
a lead closed under the old list stays closed.

`setDisposition` does all of this in one transaction with the disposition row:

| Step | Why |
|---|---|
| Clears `assigned_to` and `assigned_at`, records `lead.released` with `because: 'outcome'`, returns `released: true` | Both outcomes finish the lead, so both release it: it leaves the queue the moment the outcome is saved, and the agent is taken back to the queue |
| Clears `has_unread_inbound`, recording `reply.read` with `because: 'outcome'` when it was set | The agent closing the lead was reading it; a text that arrives later sets it again and brings the lead back |
| Marks every open callback done, recording `callback.done` with `because: 'outcome'` | A finished lead has no call left to make: it leaves My Callbacks and loses its queue Callback status |
| For `dnc`, blocks the number and suppresses an open conversation | "Blocking a number", below |

| After saving | The lead |
|---|---|
| Closed | Released and out of the queue at once |
| DNC | Released, and out of the queue because the number is blocked |
| No outcome, just a callback or a note | Stays held |

Because closing finishes the callbacks, Wrap up switches the callback choices off
while an outcome is chosen, and drops one already picked, with the line "Closing a
lead finishes its callbacks." - one booked in the same Save would be done the
moment it was made. A callback booked *after* closing is untouched: that is how a
lead reopens.

**A lead someone holds is never closed** (`ADMIN-LEADS.md`, rule 4): whoever picks
a closed lead up again is working it, so the card's `closed` is null and the
holder's Closed is always saved.

### Blocking a number

Four paths block a number, and every one goes through `blockNumber` in
`db/dnc.ts` - the one upsert on `dnc_list` - so a number blocked one way behaves
exactly like one blocked another:

| Path | Where | `dnc_list.reason` |
|---|---|---|
| A STOP reply, or EZ Texting's `optOut` flag on one | `api/webhooks.ts` (`STATE-MACHINE.md` rule 1) | `sms_stop` |
| The poller finding a contact already opted out on EZ Texting's side | `worker/poller.ts` (`POLLER.md`) | `ezt_opt_out` |
| An agent's DNC outcome | `db/dispositions.ts` | `agent_disposition` |
| A stop said, or 9 pressed, on the automated call - the script's or Seri's | `db/auto-calls.ts` (`AUTO-CALLS.md`) | `call_opt_out` |

A blocked number leaves the queue, `sendMessage` refuses it with
`BlockedNumberError`, the robot does not call it, the lead card raises the DNC
flag, and it reads Opted out on Admin > Leads and Blocked on the DNC list
(`ADMIN.md`, "DNC list"). The reason tells the DNC screen an agent's decision from
a lead's own opt-out.

- **No lead is needed.** `phone` is the table's only key, so a number can be
  blocked before we hold a lead for it - which is the point when a partner later
  delivers someone who has already opted out.
- **One row per number.** A number that opted out, was released and opts out again
  reuses its row: the block goes live again, the release columns are cleared, and
  the row reads as blocked with the newest reason. What it said before goes into
  the `dnc.blocked` record as `previous` (`AUDIT.md`).
- **Released, never deleted.** A START from the lead lifts every live block,
  whatever its reason - an agent's included - and keeps the row, stamping
  `released_at` and `released_reason` (`releaseNumber`; `STATE-MACHINE.md`,
  "Opting back in"). Locally, `dev:auto-call --unblock` lifts a test block
  (`dev_test`). Only a row with `released_at IS NULL` blocks anything.
- **The DNC outcome commits with the block,** in one transaction with the lead row
  locked. Write the row, then block, could leave a lead recorded as do-not-call
  whom we would still text - the failure that matters. It also suppresses an open
  conversation, the same end state as an SMS STOP. It is the only way a number
  reaches the list by hand: there is no add screen (`ADMIN.md`, rule 1). It cannot
  be undone from the app.
- **Nothing is sent to a blocked number.** `sendMessage` checks `dnc_list`
  immediately before every send, so the agent's text box is not shown on a DNC
  lead - in its place, "Texting is blocked - this number is on the do-not-call
  list." (`SmsCompose.tsx`) - rather than failing at send time.

### Agent SMS

`POST /api/leads/:id/messages`, `db/agent-sms.ts`, 201 with the message.

- **Sending one stops the automated questions** - `STATE-MACHINE.md` rule 2b owns
  the rule. The response carries `tookOver: true` when this send is what stopped
  them, so the screen can say so once rather than on every message.
- **The body is capped at one segment, 160 characters** (`AGENT_SMS_LIMIT`).
  Longer costs a second segment on every send; the compose box counts down to the
  same number.
- **The text is sent before it is recorded** - the opposite of the usual order
  here, and deliberate. Writing first and sending second means a failed send leaves
  a message on the lead's timeline that never arrived, and rule 2b would have
  silenced the automated flow on the strength of it. Sending first means the worst
  case is a delivered text we failed to record - visible in EZ Texting, recoverable.
  The message, the take-over time (`agent_took_over_at`, set once) and `sms.sent`
  then commit together, and a missed call's callback is finished as texted back
  (`CALLBACKS.md`).
- **A blocked number is refused by `sendMessage` itself.** The route answers 409
  `number_blocked`; no message is written, no take-over recorded, and `sms.blocked`
  goes to the activity log - its only record, shown on the timeline.
- **A text EZ Texting refuses stays in the thread, marked not sent.** The route
  answers 502 `send_failed`, and the message is kept with `delivery_status =
  'failed'` in the same statement as its `sms.failed` record
  (`recordAgentFailedSend`, `db/failed-sends.ts`), shown with a red "!" - "Delivery
  failed" on the Lead Timeline page, as for a refused automated text. It takes
  nothing over, because nothing reached the lead.
- **The timeline calls it an agent message** because `messages.sent_by` is set
  (`TIMELINE.md`).

### The workspace on screen

`/leads/:id` (`pages/WorkspacePage.tsx`, made afresh for each lead - `FRONTEND.md`,
"The screens").

#### One page for every lead, picked or not

On a lead you hold everything works. On any other the page is the same, but Wrap up
and the message box are each a disabled `<fieldset>`, so no control can be missed, and
a strip says why - "<name> is working this lead. You can look, but not act on it.",
"This lead is closed. Pick it up only to work it again.", or "You are viewing this
lead. Pick it up to text them or record an outcome." with **Pick up**. The server
refuses the write anyway ("Every write needs the lead to be yours"); the disabled
controls only save a round trip. Above it: "← Back to queue", "Lead 3 of 12" - fetched
once, not polled, since a number shuffling under the reader is worse than a stale one,
and absent when the lead is not in the queue - and "Held by you · since 3:04 PM" with
Release. A blocked number puts "This number is on the do-not-call list. Calling and
texting are blocked." across the page; unclear replies put "Unclear replies - read the
raw messages below before acting."

#### Layout

A header card over three cards. **The header** (`LeadHeader.tsx`): the name; phone,
source in words ("Web interface", "API") and age; **Score** "90 / 100"; **Questions**
and the badges ("The lead card"); the Call button (`TWILIO.md`, "The screen"). **The
cards:** left, "What Priya told us" as plain text and the score breakdown, light blue
to navy (`LeadAnswers.tsx`), with the Notes card; centre, the conversation and the
message box; right, Wrap up.

#### Notes on the workspace

Newest first, each with who wrote it and when; the three newest show, and "Show all
N" opens the rest (`LeadNotes.tsx`). It reads the timeline the page already polls,
refreshed after every save, so a new note shows at once - for the agent about to call,
who most needs "wants a call after 5 PM".

#### The conversation

`Conversation.tsx`: the SMS thread, each call as one quiet line, and the system
markers - inbound left, ours right, an automated send marked `Auto` and an agent's own
carrying their name. A reply carries the answer the server recorded for it - "1 | Yes"
(`replyLabel`; `TIMELINE.md`, "Messages"). **Notes, callbacks, outcomes and log entries
are not in it**: an agent on a call wants what the lead said, and the rest is one click
away on the Lead Timeline ("Full timeline →"). On opening and on every new message the
box scrolls to its very end, so the newest message is never below the edge.

#### A label wherever the day changes

Each item shows only its time, so a small label sits between the days, as on a
phone: **Today**, **Yesterday**, **Wed, Oct 14** - the year only for another year -
centred between two hairlines (`.convo__day`). Any item can start a day. It is the
viewer's own day; "Yesterday" is the calendar day before, not 24 hours back. The Lead
Timeline names its days through the same rule, `dayLabel` in `lib/format.ts`.

#### The message box

`SmsCompose.tsx`, at the foot of the conversation. Enter sends, Shift+Enter starts a
new line, and four templates sit behind a button - "Missed you", "Following up",
"Confirming callback", "Still interested?" - in the code, not `settings`: a mistyped
one costs one awkward message, not every lead's. It counts down from 160 characters.

- **The warning that sending stops the questions** shows once there is text and before
  the first send, because it cannot be undone (`STATE-MACHINE.md` rule 2b) - and only
  while the questions are running and nobody has taken them over
  (`sendingStopsQuestions`): a completed, expired or review conversation, or one a
  phone call already stopped (rule 2d), has none left to stop. The first send adds
  "Agent took over - automated questions stopped" to the thread. On a DNC lead there is
  no message box at all ("Blocking a number").
- **Ticks and a red "!", not banners.** Two ticks when EZ Texting accepted a send - not
  "reached the phone": no delivery reports are read, so there is no one-tick state; a
  red "!" and no ticks when it refused ("Not sent - EZ Texting did not accept it"),
  automated sends too. The box is cleared either way; when nothing is kept - a blocked
  number, a lead no longer yours - the text stays and a red line says why.

#### Wrap up

`ActionsPanel.tsx`: three numbered sections and one button.

1. **Outcome** - Closed and DNC. DNC opens a confirm dialog saying only the lead can
   undo it, by texting START ("Dispositions").
2. **Callback** - `In 1 hour`, `Tomorrow 10 AM`, `Tomorrow 3 PM` and `Other…`. The
   chosen one is brand navy, and pressing it again books nothing. `Other…` opens the
   calendar (`components/DateTimeField.tsx`; `FRONTEND-STYLE.md`, "Picking a date and
   time") and then shows the date itself ("Sep 30, 3:00 PM"), with Clear. The choices
   are switched off while an outcome is chosen ("Closing a lead").
3. **Note** - a field named by its heading.

Then **Save**; every part is optional. **One Save, three writes** - note, callback,
outcome - each append-only, so a partial failure keeps what succeeded and the panel
names the part that failed. A muted "✓ Saved 7:01 PM" beside the button says it
worked, a short red line that it did not. With Closed or DNC the agent is taken back
to the queue; with only a note or a callback they stay, holding the lead. **The
unsaved-changes guard** asks before the tab is closed or reloaded, but cannot stop
Back to queue or the browser's Back.

### Callbacks

Booking, rescheduling and completing callbacks, My Callbacks, a missed call's
callback and Seri's call backs are `CALLBACKS.md`.

### The timeline

The lead's merged history is `TIMELINE.md`.

## Rules

1. **One agent at a time.** The claim is one UPDATE whose WHERE clause is the rule;
   a second agent gets 409 `already_claimed`.
2. **A claim never expires** ("Claim and release" says why). A lead stays with its holder
   until they save an outcome or press Release; leaving the page does not release
   it. A superadmin may release anyone's.
3. **A claim by a deactivated agent counts as nobody's** - in the claim, the
   release, the write guard, the lead card and the queue alike.
4. **Every write on a lead needs the caller to hold it,** checked before the body is
   read (`requireHolding`). Reading needs no claim.
5. **Every pick-up and release is recorded** in the same statement - `lead.picked_up`,
   `lead.released` with `heldSince` (`AUDIT.md`).
6. **Picking a lead, not opening it, marks its reply read.** The `GET` never clears
   the flag.
7. **Notes and dispositions are append-only.**
8. **Every block goes through `db/dnc.ts`**: one row per number, released and never
   deleted.
9. **Nothing is sent to a blocked number** - `sendMessage` checks `dnc_list` before
   every send.
10. **An agent's text is sent before it is recorded;** a refused one is kept, marked
    failed, and takes nothing over.
11. **An agent's text stops the automated questions** (`STATE-MACHINE.md` rule 2b),
    **and so does a phone call** (rule 2d).

## Data

Writes `leads.assigned_to`, `assigned_at` and `has_unread_inbound`; `notes`;
`dispositions`; `dnc_list`; `messages` (an agent's text, `sent_by` set);
`conversations.agent_took_over_at`, and `status = 'suppressed'` on a DNC outcome;
`callbacks.done_at` when an outcome finishes them, and `callbacks.agent_id` when a
pick-up takes one nobody has; and the `activity_log` row for each. Reads the newest
`conversations` row, `conversation_answers`, `flows`, `flow_questions`, `users`,
`calls` and `callbacks` for the card. `SCHEMA.md` has the tables; `AUDIT.md` every
action recorded.

## Code

| File | What it does |
|---|---|
| `backend/src/api/leads.ts` | `POST /api/leads/:id/claim`, `/release` |
| `backend/src/api/lead-workspace.ts` | Every route on one lead; `requireHolding`, `parseBody` |
| `backend/src/db/claims.ts` | `claimLead`, `releaseLead`, `takeCallWithLead` |
| `backend/src/db/holder.ts` | `holding`: mine, free, someone else's |
| `backend/src/db/lead-detail.ts` | `getLeadDetail`, the lead card |
| `backend/src/core/score-breakdown.ts` | `answerChips`, `scoreBreakdown` - pure |
| `backend/src/db/read-flag.ts` | `markLeadRead` |
| `backend/src/db/notes.ts` | `addNote` |
| `backend/src/core/dispositions.ts` | `DISPOSITIONS`, `RETIRED_DISPOSITIONS`, `CLOSING_DISPOSITIONS`, `DNC_DISPOSITION` |
| `backend/src/db/dispositions.ts` | `setDisposition`: the outcome, the release, the block, the callbacks, in one transaction |
| `backend/src/db/dnc.ts` | `blockNumber`, `releaseNumber`, `isBlockedNow`, `DNC_REASONS`, `RELEASE_REASONS` |
| `backend/src/db/agent-sms.ts` | `sendAgentSms`, `AGENT_SMS_LIMIT` |
| `backend/src/db/failed-sends.ts` | `recordAgentFailedSend` |
| `frontend/src/pages/WorkspacePage.tsx` | The page: the data, picking and releasing, the strips and badges, marking read, the layout |
| `frontend/src/pages/workspace/LeadHeader.tsx` | The header card; `questionsLabel`, `aiCallbackLabel` |
| `frontend/src/pages/workspace/LeadAnswers.tsx`, `frontend/src/pages/workspace/LeadNotes.tsx` | The left column |
| `frontend/src/pages/workspace/Conversation.tsx`, `frontend/src/pages/workspace/SmsCompose.tsx` | The conversation and the message box; `replyLabel`, `sendingStopsQuestions` |
| `frontend/src/pages/workspace/ActionsPanel.tsx` | Wrap up |
| `frontend/src/pages/workspace/CallControl.tsx`, `frontend/src/pages/workspace/CallBar.tsx`, `frontend/src/pages/workspace/useLeadCall.ts` | Calling - `TWILIO.md` |
| `frontend/src/lib/lock.ts` | `rowAction`, `mayRelease` |

## Tests

| What | Where |
|---|---|
| Two agents claiming in the same millisecond leave exactly one holder; re-claiming keeps `assigned_at`; a deactivated agent's claim is free; release and force-release | `scripts/claims-live-check.ts`, `api/__tests__/claims.test.ts` |
| The write guard on every route: mine, free, someone else's, no such lead | `api/__tests__/holder-guard.test.ts` |
| The card's SQL: which conversation wins, the released-DNC join, the deactivated holder | `scripts/lead-detail-live-check.ts`, `api/__tests__/lead-detail.test.ts` |
| The chips and the breakdown | `core/score-breakdown.test.ts` |
| A taken-over lead leaves the queue once read; a completed one stays | `scripts/read-flag-live-check.ts`, `api/__tests__/read-flag.test.ts` |
| Notes | `api/__tests__/notes.test.ts` |
| The outcome's transaction; blocking reuses the one row a number may have; a blocked lead leaves the queue and a released one returns; re-blocking after a release clears the release columns; Closed takes a lead out, the retired closing values still do, and what keeps or brings a closed one back; a lead someone holds is never closed | `scripts/dispositions-live-check.ts`, `api/__tests__/dispositions.test.ts`, `core/dispositions.test.ts` |
| An agent's text: a reply before it advances and scores, the same reply after it does nothing, the take-over set once, neither a blocked number nor a failed send records one; a phone call stops the questions too. It stubs `axios`, not `sendMessage`, so the real `dnc_list` check stays in the path | `scripts/agent-sms-live-check.ts`, `api/__tests__/agent-sms.test.ts` |
| Release and the lock on screen | `lib/lock.test.ts` |
| The header's source and Questions wording, a sub-question ("Q1-a") included; a phone call stopping the questions; the badge of a call back Seri booked | `pages/workspace/LeadHeader.test.ts` |
| When the message box warns that sending stops the questions: only while they run and nobody has taken them over | `pages/workspace/SmsCompose.test.ts` |
| The answer shown beside a reply: the server's, and nothing when it would repeat the reply | `pages/workspace/Conversation.test.ts` |
| The sent ticks and the red "!"; a call as one line, the robot's call with its answers folded under it; a label where the day changes | `pages/workspace/Conversation.render.test.tsx` |
| The Notes card: newest first, three then Show all, the author, the empty state | `pages/workspace/LeadNotes.test.tsx` |
| The score breakdown's light-blue-to-navy shades, and each line's words | `pages/workspace/LeadAnswers.test.ts` |
| A lead's whole life, claim to block | `npm run e2e` - `backend/scripts/end-to-end.ts` |

## Not done

- **State and Consent ref** on the lead card have no data: EZ Texting sends neither
  (`EZTEXTING-API.md`).
- **"Seen before"** needs repeat-lead handling, not built (`STATE-MACHINE.md`, "A
  number that comes back").
- **Closed asks no reason.** Phase 8 makes it ask why - Sold, Not interested or Wrong
  number - so a closed lead knows whether a new bucket may start (`BUCKETS.md`, "A
  closed lead joins a new bucket"; B04).
- **Nothing releases a lead by itself** (rule 2) - a superadmin's Release is the way
  out.

## Decisions

| Decision | By | Date |
|---|---|---|
| Every write on a lead needs the caller to hold it; reading does not | Jeel | 2026-09-28 |
| A lead stays with the agent who picked it up until they let it go on purpose - an outcome or Release; Back to queue only goes back | Jeel | 2026-10-08 |
| Wrap up has two outcomes, Closed and DNC, with no reason to pick; the note says why | Jeel | 2026-09-28 |
| Both outcomes release the lead and end the visit, back to the queue | Jeel | 2026-09-29 |
| Closing finishes the lead's open callbacks | Jeel | 2026-09-29 |
| A text EZ Texting refuses stays in the thread, marked not sent; a send's result shows in the thread - two ticks, or a red "!" - not as a banner, two ticks meaning EZ Texting accepted it, with no one-tick state | Jeel | 2026-09-28 |
| The workspace rebuilt to Jeel's mockup: a header card over three cards, the conversation in the centre, notes, callbacks and outcomes on the Lead Timeline | Jeel | 2026-09-28 |
| One button, Save; Save & next lead dropped - nothing moves an agent on to a lead they did not choose | Jeel | 2026-09-28 |
| Notes on the workspace, under the score breakdown | Jeel | 2026-09-29 |
| The header made plainer; the tier and Send SMS left out of it | Jeel | 2026-09-29 |
| Wrap up's callback as one set of choices - three quick ones and Other… | Jeel | 2026-09-29 |
| A label where the day changes in the conversation | Jeel | 2026-10-18 |
| START releases an agent's block too: someone who asks to be contacted again is asking whatever the block was for | Jeel | 2026-09-22 |

## History

- 2026-11-27 · Rewritten to the area standard: dated notes to this History, decisions to a table; callbacks split out to `CALLBACKS.md` and the timeline to `TIMELINE.md`; rules 2b and 2d linked to `STATE-MACHINE.md` rather than restated; the DNC block paths owned here, as "Blocking a number"; "What it needed that did not exist" and the check counts moved here. Merged in: the workspace screen from `FRONTEND.md` ("The workspace on screen"), and why claims never expire from `SCHEMA.md` · docs standard · D20, D26, D09
- 2026-11-23 · A deactivated agent's open call backs are nobody's, and picking the lead up takes them · review D2
- 2026-11-23 · The text box on a DNC lead is not shown, with the line in its place; this doc had called it "disabled", which the code never was · review R15
- 2026-11-22 · An outcome is refused - 409 `not_yours` - on a lead another active person holds by the time it is saved: a release by a superadmin and someone else's pick-up in between had let one agent's outcome release another's claim and close their call backs. An unread reply an outcome clears is recorded as read, `because: 'outcome'` · review M10, M20
- 2026-11-22 · Release works on a deactivated agent's claim for any agent - it was a 403 naming the deactivated person; a claim that lost the race to someone who has let the lead go again is tried once more, rather than answer "null is already working this lead"; Release switched off during an answered incoming call taken on the page - it stayed live, and the note after it was then refused · review M9, M42, M27
- 2026-11-22 · An agent's refused text and its `sms.failed` record in one statement; two writes could leave either without the other · review M12
- 2026-11-13 · A lead who talked to Seri has the text questions stop, like an answer on the script's call (rule 2d) · A20 doc check
- 2026-11-12 · A pick-up takes a call back Seri booked that nobody has taken, in the same statement; the lead card carries `aiCallback` · A15, A16
- 2026-10-27 · A phone call stops the questions (rule 2d): the card carries `phoneTookOverAt`, the page "Phone call - questions stopped" and "Stopped at Q1 by a call"; the message box's warning shows only while the questions run (`sendingStopsQuestions`) - it had warned on a completed, expired or review conversation too · Jeel, T25 doc check
- 2026-10-24 · The card's `flags.missedYes`, a "yes" on the automated call nobody took · T22
- 2026-10-18 · The workspace conversation marks each day where it changes - Today, Yesterday, Wed, Oct 14 - in the viewer's own time zone, through one rule shared with the timeline (`dayLabel`, `lib/format.ts`), which gained Today and Yesterday too (`FRONTEND.md`) · Jeel asked: the conversation showed only times, so a lead worked over several days read as one afternoon · W1 (in `AUTO-CALLS.md`'s tracker until 2026-11-27)
- 2026-10-08 · Back to queue stopped releasing the lead, and a Release button came on the lead's page, for the holder and for a superadmin on anyone's. On the first day of real use an agent called a lead twice, reached voicemail, left a note and a text, went back to the list - and the lead was free for anyone, which nobody had decided. From 2026-09-28 the release endpoint had accepted a superadmin releasing anyone's claim, but no screen offered it · Jeel
- 2026-10-06 · The conversation labels a reply with the answer it was recorded as, from the timeline (`detail.answer`, `TIMELINE.md`); the screen had worked it out from the chips · flows
- 2026-10-06 · `conversation.question` by the question's own name; it was the bare position, and the offers question read "Q4" · flows
- 2026-10-05 · The chips and the breakdown from the answers saved in `conversation_answers`, with each question's heading. The screen had "Interest:" and "Timing:" written into it for the first two questions, found in the browser when the antibiotics flow read "Interest: Yes". Before, the words came from `scoring_rules.label` - `Q1: Both` with the prefix stripped - not from the question copy in `settings`: those labels paired each choice with its points, so one row answered both "what did they say" and "what was it worth", while the copy was prose for a lead to read and free to be reworded. The prefix convention and `answerLabel` went with `scoring_rules` · Phase 5, flows
- 2026-10-01 · The DNC outcome suppresses an open conversation. It was specified here from the start but not built, found in the doc review: the conversation stayed open until it expired, and a later START was read as an unclear answer to a question nobody was asking · doc review
- 2026-10-01 · Every pick-up and release kept: releasing clears `assigned_to` and `assigned_at`, which had left no trace of who held the lead or for how long; the same statement writes `lead.picked_up` and `lead.released` with `heldSince`, and the timeline shows them · Jeel, `AUDIT.md`
- 2026-10-01 · The Call button works (`TWILIO.md`) - off, with its reason as a tooltip, only when the number is blocked, calling is not set up, the lead is not picked up, or a call is already under way; it had been built disabled until Phase 4 · Phase 4
- 2026-09-29 · The header made plainer - Jeel: the first read as generated, with an initials circle, tiny letter-spaced uppercase labels, a monospace phone and source, a big red score, a dashed Call button and a "Phase 4" note. The tier and a Send SMS button went (the score says how strong the lead is; Send SMS only moved the cursor to the box below); the answers under "What Priya told us" became plain text, not three coloured pills; "Full timeline →" a grey link turning navy, not link blue; the score breakdown, which ran from the Hot red at rising opacity - an alarm colour on every lead - runs light blue to navy. The conversation had scrolled a marker after the last message into view, stopping short by the box's padding, so a sent text looked as if it had not arrived; it goes to the box's end, measured 0px left below on open and after each of three new messages. "Pick time..." became "Other…" - three quick chips, a chip on a line of its own and a date field below had made three rows with nothing showing which had been chosen - and the "OPTIONAL" pill went. Saving Closed or DNC began ending the visit · Jeel
- 2026-09-29 · Notes shown in the workspace, in a Notes card, newest first; until then only on the Lead Timeline page, so the agent about to call never saw them, and a note saved in Wrap up vanished from the screen
- 2026-09-29 · Both outcomes release the lead: a closed lead had stayed held - and in the queue as "Working – name" - until the agent pressed Back to queue. Closing finishes the lead's callbacks; each had been marked done by hand. A lead someone holds is never closed: the same day's test found a closed lead that texted and was picked up read Closed again the moment its reply was read - Closed on Admin > Leads while the queue said "Working – Maya", and Closed already selected in the workspace, so pressing it saved nothing; before that nothing on screen said a lead was closed, and an agent in the test pressed Closed twice. The card's `closed` came with it · Jeel
- 2026-09-28 · The workspace rebuilt to Jeel's mockup, every action behaving as before. The first Wrap up grouped eight outcomes as Positive / No contact / Negative, with DNC a separate red link and a "Step N of 3" counter; Closed and DNC replaced them and took the groups and the counter; Save & next lead - which saved, released and opened the top unlocked lead - was dropped. The composer's green "Sent." box and red failure box gave way to ticks and "!", and a green banner over Wrap up to "✓ Saved". `LeadHeader` and `LeadAnswers` were split out of the page at 420 lines, the rendered page checked identical before and after - HTML and every computed style - on six leads, and every control walked in the browser with no console errors · Jeel's mockup
- 2026-09-28 · Two outcomes, Closed and DNC. There were eight - Interested, Callback set, No answer, Voicemail, Not interested, Wrong number and DNC, plus Sold for part of that day; the requirement asks for none of them, and each recorded one attempt rather than where the lead stands. Until then the queue did not read `dispositions`, so a finished lead stayed at full score and the next agent picked it up again · Jeel
- 2026-09-28 · Every write needs the lead to be yours. Before, claiming was the only place the lock was enforced: every write was accepted from anyone signed in, on any lead, so an agent who opened a colleague's lead by its address could text it or block its number, and the only guard was the screen hiding the controls · Jeel
- 2026-09-28 · Picking a lead marks it read, not opening it: a superadmin glancing at a lead, or an agent looking before deciding, had been enough to clear the flag and let an expired lead who texted back leave the queue unhandled
- 2026-09-28 · A text EZ Texting refuses kept in the thread, marked failed; before, nothing was kept and the agent retyped the text · Jeel
- 2026-09-28 · `api/lead-workspace.ts` split out of `api/leads.ts`, when it held ten routes
- 2026-09-26 · Built: claim and release (Phase 3 task 2), marking a lead read (3), the lead card (4), the timeline (5), notes (6), callbacks (7), dispositions (8) and agent SMS (9). Three things did not exist and were added: a migration for the take-over time on `conversations` (003); `agent_disposition` among `dnc_list.reason`'s values; and `sent_by` on an agent's text - outbound automated messages leave it null. Clearing the unread flag is its own `POST`, not the `GET`. The workspace screen, tasks 17-20, its Call button visible and disabled until Phase 4 · Phase 3
- 2026-09-22 · START releases an agent's block too · Jeel
