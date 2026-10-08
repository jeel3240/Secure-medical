# Agent workspace API

The endpoints behind the Agent Workspace, the Lead Timeline and My Callbacks -
`DESIGN-PROMPT.md` sections 3, 4 and 5. Phase 3.

**Built so far** (all 2026-09-26): claim and release (task 2), marking a lead
read (task 3), the lead card (task 4), the timeline (task 5), notes (task 6),
callbacks (task 7) and dispositions (task 8) - `api/leads.ts` (claim and
release), `api/lead-workspace.ts` (every route on one lead, split out
2026-09-28),
`api/callbacks.ts`, `db/claims.ts`, `db/read-flag.ts`, `db/lead-detail.ts`,
`db/timeline.ts`, `db/notes.ts`, `db/callbacks.ts`, `db/dispositions.ts`,
`db/dnc.ts`, `db/agent-sms.ts`, `core/dispositions.ts`,
`core/score-breakdown.ts`. Every route in the table below is built (task 9,
agent SMS, completed the set); everything under "Rules" is decided.

Every route is under `/api`, requires a session, and is open to any signed-in
user unless it says superadmin. See `AUTH.md`.

## Rules

**One agent at a time.** Claiming sets `assigned_to` and `assigned_at`. A second
agent claiming the same lead gets a 409 and sees the row as "Working -
{name}" in the queue. Claims never expire - `SCHEMA.md` says why - so a
superadmin can force a release.

**Every pick-up and release is kept** - 2026-10-01. Releasing clears
`assigned_to` and `assigned_at`, which used to leave no trace of who had held
the lead or for how long. The same statement now writes `lead.picked_up` and
`lead.released` to the activity log, with `heldSince`, and the Lead Timeline
shows them. So does a rescheduled callback, with both times. `AUDIT.md`.

**A lead stays with the agent who picked it up until they let it go on
purpose - Jeel, 2026-10-08.** Two things release it:

- **An outcome.** Saving Closed or DNC releases the lead ("Dispositions").
- **The Release button**, at the top right of the lead's page beside "Held by
  you · since 3:04 PM". The holder sees it on their own lead. A **superadmin
  sees it on anyone's** - "Held by Maya Chen · since 3:04 PM · Release" - which
  is the way out of a lead locked to an agent who is not there; the release is
  recorded as forced. It is switched off while a call is under way.

**Back to queue only goes back.** Until 2026-10-08 it also released the lead.
On the first day of real use an agent called a lead twice, reached voicemail,
left a note and a text, and went back to the list - and the lead was free for
anyone, which nobody had decided. Leaving a page is not a decision about the
lead. A held lead is "Working – name" in the queue, locked to everyone else,
and **Resume** for its holder.

What this costs: nothing releases a lead by itself. An agent who goes home
holding leads keeps them locked until they come back or a superadmin presses
Release. `leads.assigned_at` is how long each has been held.

*(2026-09-28 to 2026-10-08: the release endpoint already accepted a superadmin
releasing anyone's claim, but no screen offered it. A superadmin's button in
the queue on someone else's lead is still **View**, which opens the workspace
read-only and claims nothing - `QUEUE.md`, "What the button offers" - and
Release is now there on that page.)*

**A claim by a deactivated agent does not count.** The queue already ignores it
(`QUEUE.md`); the claim endpoint treats such a lead as free.

**Every write needs the lead to be yours - Jeel, 2026-09-28.** A note, a new
callback, an agent SMS, a disposition and marking a reply read are all refused
unless the caller holds the lead. Reading it is not: the workspace shows any
lead, and switches its actions off until you pick. `db/holder.ts` answers who
holds it; `requireHolding` in `api/lead-workspace.ts` runs before each write, and before
the body is validated, so a caller who may not act learns nothing from the
shape of the request.

| Caller | Response |
|---|---|
| Holds the lead | Goes ahead |
| Nobody holds it | 409 `not_picked` - "Pick this lead before acting on it." |
| Someone else holds it | 409 `already_claimed` - "{name} is working this lead." |
| No such lead | 404 |

Before this, claiming was the only place the lock was enforced. Every write was
accepted from anyone signed in, on any lead: an agent who opened a colleague's
lead by its address could text it or block its number, and the only guard was
the screen hiding the controls. A claim held by a deactivated agent reads as
free, matching the claim endpoint. Rescheduling or completing a callback from
My Callbacks (`PATCH /api/callbacks/:id`) is not guarded - it is the agent's own
callback, and they may not hold the lead at that moment.

**Picking a lead marks it read,** clearing `leads.has_unread_inbound` - not
opening it. *(2026-09-28: it used to be opening, and a superadmin glancing at a
lead, or an agent looking before deciding, was enough to clear the flag and let
an expired lead who texted back leave the queue unhandled.)* The flag is what
brings that lead into the queue, and nothing cleared it until Phase 3 task 3,
so the lead never left.

*Changed 2026-09-26:* the clearing is `POST /api/leads/:id/read`, and the `GET`
does **not** do it. The workspace polls the lead every few seconds, so a `GET`
that cleared the flag would clear it on the first tick whether or not anyone had
read the message - and a list that prefetched detail would mark leads read that
nobody opened. The frontend says when a lead counts as opened.

**An agent SMS stops the automated questions.** It sets the take-over timestamp
on the conversation - when the newest conversation is still open and not
already taken over; a finished one has no questions left to stop. From then on replies are stored for the agent and never
scored. STOP and START still work. The rule and the reason are in
`STATE-MACHINE.md`, "An agent has taken the conversation over" - that is the
authority, not this file.

**A text EZ Texting refuses stays in the thread, marked "not sent"** - Jeel,
2026-09-28. The API still answers 502 `send_failed`, but the message is kept
with `delivery_status = 'failed'` and shown with a red "!"; it does not take the
conversation over, because nothing reached the lead. Before that nothing was
kept and the agent retyped the text. `db/failed-sends.ts`; `FRONTEND.md`.

**The DNC disposition blocks the number** for SMS and calls: it writes
`dnc_list` with reason `agent_disposition` and suppresses any open conversation
*(the suppressing was specified here from the start but only built on
2026-10-01, found in the doc review; until then the conversation stayed open
until it expired)*, the
same end state as an SMS STOP. It is the only way a number reaches that list by
hand - there is no manual add screen (Jeel, 2026-09-23). It needs a confirm
dialog, and it cannot be undone from the app.

**Nothing is sent to a blocked number.** `sendMessage` already refuses one, so
the agent SMS box is disabled on a DNC lead rather than failing at send time.

## Endpoints

| Method | Path | Does |
|---|---|---|
| `GET` | `/api/leads/:id` | Lead card: name, phone, source, age, score, tier, the conversation, answer chips, score breakdown, the holder (`claimedBy`), `closed` (who closed it and when, while it is closed), flags (DNC, needs review, unread, expired, missed call). Read-only - see below. |
| `GET` | `/api/leads/:id/timeline` | Every event for the lead, oldest first: system, outbound SMS, inbound reply, agent SMS, call, note, callback, disposition, and `activity` - the log entries with no row of their own (`AUDIT.md`). |
| `POST` | `/api/leads/:id/read` | Clears `has_unread_inbound`. 204, idempotent. |
| `POST` | `/api/leads/:id/claim` | Claims it. 409 `already_claimed` with the holder's name when someone else has it. |
| `POST` | `/api/leads/:id/release` | Releases your own claim. A superadmin may release anyone's. |
| `POST` | `/api/leads/:id/notes` | `{ body }`. |
| `POST` | `/api/leads/:id/messages` | `{ body }` - agent SMS, one segment (160). Sets the take-over timestamp. 409 on a DNC number, 502 when EZ Texting refuses it. |
| `POST` | `/api/leads/:id/dispositions` | `{ value, confirmDnc? }` - `closed` or `dnc`, "Dispositions" below. `dnc` also blocks the number and needs `confirmDnc: true`. |
| `POST` | `/api/leads/:id/callbacks` | `{ scheduledAt, agentId? }` - defaults to you; a superadmin may assign another agent. |
| `PATCH` | `/api/callbacks/:id` | `{ scheduledAt }` to reschedule, `{ done: true }` to complete, or both; `{ done: false }` reopens a done one. |
| `GET` | `/api/callbacks?when=today\|upcoming\|overdue\|all&agentId=&tz=` | My Callbacks. `tz` is the viewer's time zone, for where today ends. `agentId` is superadmin only: an agent's id, or `all` for every agent's (2026-09-28). |

## Notes

`db/notes.ts`, `POST /api/leads/:id/notes`, 201 with the note.

**Append-only.** A note records what an agent thought at a moment and the
timeline shows it in sequence; nothing edits or deletes one. `notes` has no
`updated_at`, which is the schema saying the same thing.

**Shown in the workspace - 2026-09-29.** A Notes card in the left column lists
them newest first with who wrote each and when (`FRONTEND.md`); until then they
were only on the Lead Timeline page, so the agent about to call never saw them.

**The author is the session,** never the payload - a body carrying `agentId` is
ignored. **The route needs the caller to hold the lead,** like every write
("Every write needs the lead to be yours", above); the function under it,
`db/notes.ts`, does not check, which is why the route does.

The body is trimmed, required, and capped at 5000 characters. The cap exists so
a runaway client cannot fill the column, not to ration what an agent can say.

## Callbacks

**Today and Upcoming split at the viewer's midnight** - 2026-09-28, from review.
They split at the database's (UTC), so for a call center on US time a 9 PM
callback was already "Upcoming", and after 5 PM Pacific the Today tab showed
tomorrow's. The browser now sends its IANA zone as `?tz=`; an invalid one is a
400, none means UTC. `scripts/callbacks-live-check.ts` proves 11:59 PM local
is today and 12:01 AM local is upcoming.

`db/callbacks.ts`, `api/callbacks.ts`, and `POST /api/leads/:id/callbacks` on
the leads router - creating one belongs to a lead, the rest belong to the agent.
Backs My Callbacks, `DESIGN-PROMPT.md` section 5.

**The tabs are windows on one column,** `scheduled_at`, filtered by
`done_at IS NULL`. A fourth, **All**, shows every callback, done ones included,
with a Done mark:

| Tab | Means |
|---|---|
| Today | From now until midnight tonight - plus any missed call's callback booked today, below |
| Upcoming | Tomorrow onwards |
| Overdue | In the past, still not done - except a missed call's callback from today |

**Today is the rest of today, not the whole day.** A callback booked for 9am and
still open at 3pm is overdue, not today. Counting it under both would let an
agent clear the Today tab while the call they missed sits unmade - the tab's job
is to say what is still ahead of them.

**A time in the past is accepted.** It arrives straight into Overdue, which is
what the screen is for. Refusing it would mean an agent logging a call they
agreed to for an hour ago has nowhere to put it.

**Counts come back for every tab, whichever tab was asked for.** The overdue
badge has to be right while the agent is looking at Today, so one request
carries all four numbers. The `all` count includes done callbacks.

**Marking a done callback done again leaves the original `done_at`,** via
`COALESCE(done_at, now())`. That timestamp is when the work happened; a double
click on Save should not rewrite it. Rescheduling, by contrast, does overwrite -
that is the point of it.

**A missed call books one by itself - Jeel, 2026-10-01.** When a lead rings our
number and the agent it rang does not pick up, the server books that agent a
callback due at that moment, `reason = 'missed_call'`. My Callbacks shows it as
**Missed call** rather than Overdue, **under Today** - it is due the second it
is booked, so by the rule above it would be overdue at once and never be on
the tab an agent opens; it moves to Overdue only when the day ends - and it is marked done when anyone calls or
texts the lead back, or answers when they ring again. Every other callback is
`reason = 'booked'` and is finished only by a person or by an outcome. A lead
who rings several times is still one row: it reads **Missed 3 calls** and shows
the time of the latest, both read from `calls` rather than written onto the
callback, so the first call's time is not overwritten.
`TWILIO.md`, "A missed call".

**Whose callback it is.** An agent sees and changes only their own; a superadmin
may list another agent's and may change one, which is how a callback left by
someone off sick gets moved. A refusal names the owner so the screen can say who
rather than just no.

**The list row carries what the screen shows** - lead name, phone, source,
tier, the newest note, who holds the lead now (`holder`, for Pick up / Resume
/ View), the callback's `reason`, and for a missed call `missedCalls {count,
lastAt}` - so My Callbacks needs one request, not one per row. There is no
score, only the tier.

`scripts/callbacks-live-check.ts` proves the parts that are date arithmetic
against a real database: the three windows, that a booked callback whose time
has passed is overdue and not also today, that completing twice keeps the
first time, and that rescheduling moves a callback between tabs - 29 checks.
The missed call's callback - booked once, under Today, its count and latest
time, what finishes it - is in `scripts/calls-live-check.ts` and
`agent-sms-live-check.ts`.


## Dispositions

`db/dispositions.ts` for the write, `core/dispositions.ts` for the list,
`POST /api/leads/:id/dispositions`, 201 with the row.

**Two: `closed` and `dnc` - Jeel, 2026-09-28.** Wrap up has two outcome
buttons, Closed and DNC, then the callback and the note.

There were eight - Interested, Callback set, No answer, Voicemail, Not
interested, Wrong number and DNC, plus Sold for part of that day. The
requirement asks for none of them, and each recorded one attempt rather than
where the lead stands. What they said is covered elsewhere:

| Was | Now |
|---|---|
| Callback set | Booking the callback, section 2 - it is its own record and on My Callbacks |
| No answer, Voicemail | The note - and every call is a row in `calls`, with how it ended (`TWILIO.md`) |
| Interested | The note, or a callback |
| Sold, Not interested, Wrong number | **Closed**, with the note saying why |

`dispositions.value` is plain TEXT with no check constraint, so
`core/dispositions.ts` is the only thing keeping new rows to a known set -
changing it needs no migration. The route refuses the retired values with 400
`invalid_disposition`. Rows already holding them stay, and the timeline and
Overview still name them. The route accepts any case and trims, so `  Closed `
stores `closed`.

**Append-only, like notes.** Nothing updates or deletes a disposition. The
timeline shows the sequence, which is the point: a lead closed, reopened by a
callback and closed again is a different story from one closed once.

**DNC needs `confirmDnc: true`.** The value alone is refused with 400
`confirm_required`. `DESIGN-PROMPT.md` 3 puts a confirm dialog in front of it
on the screen; the same guard sits on the API, because the block is lifted only
by a START from the lead and a mis-typed request should not be able to set it.
Closed needs no confirmation.

**The block and the disposition commit together,** in one transaction with the
lead row locked. The alternative - write the row, then block - can leave a lead
recorded as do-not-call whom we would still text, which is the failure that
actually matters.

**It is the same `dnc_list` row a STOP reply writes.** `db/dnc.ts` holds the one
upsert all three blocking paths use - a STOP reply, the poller finding a contact
already opted out, and this. So a number blocked by an agent behaves exactly
like one blocked by a STOP: it leaves the queue, `sendMessage` refuses it with
`BlockedNumberError`, the lead card raises the DNC flag, and a later START
releases it (Jeel, 2026-09-22 - START releases an agent's block too). The reason
is stored as `agent_disposition` so the DNC screen can tell the two apart.

### Closing a lead - 2026-09-28

**Closed finishes the lead.** It leaves the queue and reads Closed on Admin >
Leads (`ADMIN-LEADS.md`, "Closed"). `CLOSING_DISPOSITIONS` in
`core/dispositions.ts` is the list - `closed`, and the retired `sold`,
`not_interested` and `wrong_number`, so a lead closed under the old list stays
closed - and `db/lead-state.ts` is the one SQL definition both screens use.

| After saving | The lead |
|---|---|
| Closed | Released and out of the queue at once, and the agent is taken back to the queue. Until 2026-09-29 it stayed held - and in the queue as "Working – name" - until the agent pressed Back to queue; nobody needed to pick it up, so that was only confusing |
| DNC | Leaves the queue, because the number is blocked; released too, from 2026-09-29 |
| No outcome, just a callback or a note | Stays |

**How it is done.** `setDisposition` (`db/dispositions.ts`) clears
`assigned_to`, `assigned_at` and `has_unread_inbound` in the same transaction as
the disposition row, and returns `released: true`. The unread flag goes too
because the agent closing the lead was reading it; a text that arrives later
sets it again. The lead card carries `closed: { by, at }` while the lead is
closed, by the same rule as the queue, so the workspace shows Closed as the
selected outcome, "Closed by Maya · 7:01 PM" under it, and a Closed badge.

**A lead someone holds is never closed - Jeel, 2026-09-29.** Whoever picks a
closed lead up again is working it, so `CLOSED_SQL` excludes a lead with an
active holder: Admin > Leads reads Working, the card's `closed` is null, and the
holder's buttons start clear, so their Closed is always saved. The same day's
test found both halves: a closed lead that texted and was picked up read Closed
again the moment the reply was read - Closed on Admin > Leads while the queue
said "Working – Maya", and Closed already selected in the workspace, so
pressing it saved nothing. Before
that nothing on screen said a lead was closed, and an agent in the 2026-09-29
test pressed Closed twice. `scripts/dispositions-live-check.ts` proves it.

**What brings a closed lead back:**

- **The lead texts us.** It returns as an Inbound reply, because a person has
  to read it. Read and left alone, it is closed again - nobody presses Closed
  twice. Picked up, it is Working until the agent saves an outcome or lets go.
- **An agent books a callback after closing it.** "Actually, call me Friday"
  keeps the lead in reach until that callback is done.
- **The lead rings us and nobody answers** (2026-10-01). It returns as Missed
  call until someone gets back to them - a call, a text, answering when they
  ring again, or a new outcome. `TWILIO.md`, "A missed call".
- **An agent picks it up again.** A lead someone holds is never closed, above.

**Closing finishes the lead's callbacks - Jeel, 2026-09-29.** Closed and DNC
mark every callback still open as done, in the same transaction, so a finished
lead leaves My Callbacks and loses its queue Callback status too; until then
each had to be marked done by hand. Because of that, Wrap up switches the
callback choices off while an outcome is chosen, and drops one already picked,
with the line "Closing a lead finishes its callbacks." - one booked in the same
Save would be done the moment it was made. A callback booked *after* closing is
untouched: that is still how a lead reopens.

Until this change the queue did not read `dispositions` at all, so a finished
lead stayed at full score and the next agent picked it up again.

`scripts/dispositions-live-check.ts` proves the parts that live in the database:
the transaction, that blocking reuses the single row a number is allowed, that a
blocked lead leaves the queue and a released one returns, that re-blocking
after a release clears the release columns - and that Closed takes a lead out,
the retired closing values still do, and what keeps or brings a closed one
back - 43 checks as of 2026-10-01, all passing.


## Agent SMS

`db/agent-sms.ts`, `POST /api/leads/:id/messages`, 201 with the message.

**Sending one stops the automated questions** - `STATE-MACHINE.md` rule 2b,
Jeel's decision of 2026-09-23. The response carries `tookOver: true` when this
send is what stopped them, so the screen can say so once rather than on every
message.

**The body is capped at one segment, 160 characters.** Longer costs a second
segment on every send. The compose box counts down to the same number -
`DESIGN-PROMPT.md` 3.

**The text is sent before it is recorded,** which is the opposite of the usual
order here and deliberate. Writing first and sending second means a failed send
leaves a message in the lead's timeline that never arrived, and rule 2b would
have silenced the automated flow on the strength of it. Sending first means the
worst case is a delivered text we failed to record - visible in EZ Texting,
recoverable - rather than a silent lie in the timeline. The record and the
take-over timestamp then commit together.

**A blocked number is refused by `sendMessage` itself,** which checks `dnc_list`
immediately before every send. The route answers 409 `number_blocked`; no
message is written and no take-over is recorded, and `sms.blocked` goes to the
activity log - its only record, shown on the timeline. A failed send answers
502 and the text is kept, marked failed ("A text EZ Texting refuses stays in
the thread", above), with `sms.failed` in the log; it records no take-over.

**The timeline calls it an agent message** because `messages.sent_by` is set;
one table gives three kinds - a reply, one of ours, and an agent's.

`scripts/agent-sms-live-check.ts` proves the handoff end to end: a reply before
it advances and scores, the same reply after it does nothing, the timestamp is
set once, and neither a blocked number nor a failed send records one. It stubs
axios rather than `sendMessage`, so the real `dnc_list` check stays in the path
- stubbing `sendMessage` would remove the guard the script is there to prove.


## How the lead card is built

`db/lead-detail.ts` for the query, `core/score-breakdown.ts` for the words.

**One chip per question the lead answered**, with the question's own heading -
whatever their flow asked, and nothing for a branch they never took
(2026-10-05, `FLOWS.md`). **The answer words are the ones saved with each answer** (`conversation_answers`), not the choices' current names - so the chips, the
breakdown and the incoming-call card keep showing what the lead actually
picked after a choice is renamed. `STATE-MACHINE.md`, "An answer keeps what
it was".

**The newest conversation is the card.** A lateral join picks it, the same way
the queue and Admin > Leads do. Earlier ones stay on the lead as history; the
flags follow the newest, so a lead whose old conversation expired but whose new
one is open does not read as expired.

**A released `dnc_list` row does not raise the DNC flag.** The join is
`released_at IS NULL`. A number that opted out and later texted START is
contactable again - migration 002 - and the row is kept only as the record.

**A claim by a deactivated agent is not reported as a holder,** matching the
queue and the claim endpoint. All three have to agree or the card would show a
lead as held by someone who cannot work it.

**Each answer chip carries the raw `choice` as well as its words** - `1`, `2`
or `3`. There is a chip only for a question the lead answered.

**The conversation labels a reply with the answer it was recorded as** - "1 |
Yes" - **and that answer now comes with the message** (2026-10-06). Each row of
`conversation_answers` names the inbound text it was read from (`message_id`,
migration 012), the timeline puts the answer's label on that entry
(`detail.answer`), and the screen shows it; nothing is added when the lead
typed the answer's own words. Until then the screen worked it out from the
chips, walking them in order and matching digits. That was wrong whenever an
earlier answer had been typed as a word: "yes", "2", "1" showed "1 | Yes" on
the third reply, which meant "I know which antibiotic" - and the antibiotics
flow made worded answers the ordinary case. Two walks on one lead mislabelled
the first with the second's answers. Found in review; proved in
`scripts/timeline-live-check.ts`.

**The card says which question the lead is on, or stopped at** -
`conversation.question`, "Q2" or "Q1-a" (`core/questions.ts`; `FLOWS.md`,
"Naming a question"). The header's "On Q2", "Stopped at Q1-a" and the
incoming-call card read it. It was built from the bare position, which read
"Q4" for the offers question. A conversation whose question cannot be found
says only "Open" or "Stopped": the position is an order, not a number to
print.

**The breakdown shows only what was earned.** A lead who stopped after question
1 gets two lines, not five with zeros: the card records what happened rather
than scoring what was possible. The lines are built from the answers saved in
`conversation_answers`, with the label and points each had when it was given,
plus the flow's awards for replying and for finishing. An answer's line also
carries the question's `heading`, and the screen shows the two together -
"Requested info: Yes  +20" - because "Yes +20" does not say yes to what. *(The
screen had "Interest:" and "Timing:" written into it for the first two
questions; found in the browser on 2026-10-05, when the antibiotics flow read
"Interest: Yes".)*

`scripts/lead-detail-live-check.ts` proves the parts that live in SQL - which
conversation wins, the released-DNC join, the deactivated holder - against a
real database.

## Marking a lead read

`db/read-flag.ts`, `POST /api/leads/:id/read`. Built as its own endpoint rather
than only as a side effect of `GET /api/leads/:id`, so the frontend decides when
a lead counts as opened - a list that prefetches detail would otherwise silently
mark leads read that nobody looked at. The `GET` never clears it: reading the card is not
handling the lead.

**Idempotent.** Marking an already-read lead read is a 204: the caller wanted it
read and it is. The function reports whether this call was the one that changed
it, which is what a log line keys on.

**The route needs the caller to hold the lead** ("Picking a lead marks it
read", above): looking at a lead is not handling it. The function itself,
`db/read-flag.ts`, is not scoped; the route is what enforces it.

**What it is for.** For an expired conversation, or a partway one an agent took
over, the only thing keeping the lead in the queue is this flag - `db/queue.ts`.
Nothing cleared it before, so such a lead never left.
`scripts/read-flag-live-check.ts` proves the effect against a real database: a
taken-over lead leaves the queue once read, while a completed one stays, because
the flag was never what held it there.

## How claim and release are built

`db/claims.ts`. The whole one-agent-at-a-time rule is the WHERE clause of a
single UPDATE - shown here simplified; the statement itself also locks the row
and writes `lead.picked_up` to the activity log in the same breath
(`AUDIT.md`):

```sql
WHERE l.id = $1
  AND (l.assigned_to IS NULL
       OR l.assigned_to = $2
       OR NOT EXISTS (SELECT 1 FROM users u WHERE u.id = l.assigned_to AND u.is_active))
```

**One statement, not a read then a write.** Checking whether a lead is free and
then claiming it leaves a gap where both agents see it free. Making the
condition part of the UPDATE means the database decides: the second agent's
statement matches no row and updates nothing. Two agents claiming in the same
millisecond is proved to leave exactly one holder by
`scripts/claims-live-check.ts`.

**Re-claiming a lead you already hold succeeds and leaves `assigned_at`
alone.** Opening a lead twice is not a new claim, and a timestamp that reset on
every open would stop a superadmin spotting one held since last week - which is
the only reason the column exists.

**A claim by a deactivated agent is treated as free,** matching the queue, which
already ignores it. If the two disagreed, a lead would appear free in the list
and refuse to be taken.

Status codes: 409 `already_claimed` when an active agent holds it - the caller
did nothing wrong, someone was first - and 403 `not_yours` when an agent tries
to release a claim that is not theirs. Releasing a lead nobody holds succeeds:
the caller wanted it free, and it is.

## The timeline

One merged, ordered list assembled from `messages`, `calls`, `notes`,
`callbacks` and `dispositions`, each entry carrying a `kind`, a timestamp, an
author where there is one, and its own fields. The screen decides the icons and
wording, the way it does for queue tags.

System events are not a table. They are derived from the lead and its
conversation rather than logged rows, so the timeline synthesises them.

**Built 2026-09-26**, `db/timeline.ts`. The list is assembled from `messages`,
`calls`, `notes`, `callbacks`, `dispositions` and - since 2026-10-01 - six
actions from `activity_log` that have no row of their own. Four system events, each standing on a
timestamp that actually exists:

| Event | Placed at | Why there |
|---|---|---|
| `lead_received` | `ezt_added_at` | Its own timestamp. Carries the source. |
| `scored` | `completed_at` once the flow has finished; before that, the last inbound reply | `updated_at` moves on every change, so it cannot be used. Until 2026-09-29 it was always the last reply, so a lead texting "Hi" after finishing moved "Scored · completed" down under the "Hi" - found testing with a real lead. `completed_at` (migration 004) is when the flow actually finished |
| `agent_took_over` | `agent_took_over_at` | Migration 003. |
| `conversation_expired` | `expires_at`, only when the status is `expired` | `expires_at` is set on every send, so a live conversation always has a future one that has not happened. |

An event with no timestamp to stand on is left out rather than guessed at.

**Ordering.** Oldest first, and ties are common enough to matter: `scored`
shares a timestamp with the reply that earned it, and `lead_received` shares one
with the opener it triggered. Within the same instant the order is
received → inbound → SMS → call → note → callback → disposition and log
entries → other system events, so the story reads in the sequence it happened.

**What an entry carries.** A call: `outcome`, `durationSec` and `direction`. A
callback: `scheduledAt`, `doneAt` and `reason`. `components/Timeline.tsx` words
them - "Outbound call · answered · 2:14", "Incoming call · answered · 1:15",
"Missed call · told we will call back"; a callback the system booked for a
missed call reads "Callback added · missed call", then "Missed call returned".

**Three kinds come out of `messages`.** An inbound row is a reply; an outbound
row with `sent_by` null is one of ours; an outbound row with an agent is their
manual message, written by `db/agent-sms.ts` (task 9). A reply that was
recorded as an answer carries it: `detail.answer`, the choice's label.

**The `scored` event carries how the questions ended** (`endOutcome`,
2026-10-06). A lead who asked only for offers, or to hear from a rep, has a
`completed` conversation too; the line reads "Scored 10 · LOW · offers only",
"· wants a call" or "· not interested" rather than "· completed", which read
as the questions answered. The timeline page's Status row uses the header's words for the same
reason.

`getTimeline` returns null for a lead that does not exist, so the route can tell
that apart from a lead with no history - both would otherwise be an empty list.
`scripts/timeline-live-check.ts` proves the merge, the ordering and the derived
events against a real database.

## What it needed that did not exist

*All three were built in Phase 3; kept as the record of what was missing.*

- **A migration** for the take-over timestamp on `conversations`. Nothing else
  needs a schema change: `notes`, `dispositions` and `callbacks` are already
  there and unused.
- **`dnc_list.reason` gains a value for an agent's block** - built as
  `agent_disposition`.
- **A `sent_by` value for agent SMS.** `messages.sent_by` exists; outbound
  automated messages leave it null today.

## Known gaps in the screens

- **State** and **Consent ref** on the lead card and timeline sidebar have no
  data. EZ Texting sends neither - `EZTEXTING-API.md`. They cannot be filled.
- **Seen before** and the timeline's "Previous lead" section need repeat-lead
  handling, still blocked - CLAUDE.md §10, "Future".
- ~~**The Call button** is built disabled until Phase 4.~~ *Done 2026-10-01 - `TWILIO.md`.*
- ~~**Answer chips** and the score breakdown need the choice numbers mapped to
  words.~~ *Done 2026-09-26, `core/score-breakdown.ts`.* The words come from
  the answers saved in `conversation_answers` since 2026-10-05 (`FLOWS.md`);
  before that, `scoring_rules.label` - `Q1: Both` with the prefix stripped - not from the
  question copy in `settings`. Those labels paired each choice with the
  points it earned, so one row answered both "what did they say" and "what was
  it worth"; the question copy was prose written for a lead to read and free
  to be reworded. The prefix convention, and the `answerLabel` function that
  relied on it, both went with `scoring_rules` on 2026-10-05.
