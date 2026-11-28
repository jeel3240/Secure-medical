# Admin > Leads

Every lead the poller has pulled in, whether or not they replied, each with a
status worked out from its conversation and from what agents have done - and the
robot's call beside it. Superadmin only, read-only. This doc owns the statuses,
Closed and Working among them, and the rule for what reopens a closed lead. The
route is `backend/src/api/admin/leads.ts`, the query `backend/src/db/leads.ts`
over `backend/src/db/lead-state.ts`; the screen is
`frontend/src/pages/admin/LeadsPage.tsx`, the Call column's words
`frontend/src/lib/call-results.ts` (brief: `DESIGN-PROMPT.md` section 6g).

## How it works

### Why it is separate from the queue

The agents' queue holds only leads who need a person (`QUEUE.md`, "Who is in
it"), so agents spend their time on people who have given them a reason to.
This page shows everyone, so a superadmin can see leads arriving and where they
drop off, without non-responders burying HOT leads in the agents' view. A lead
partway through the questions is here, under Answering, and usually nowhere
else.

### Status

There is no status column on `leads`. Each row's status is worked out on every
request from the lead's newest conversation and from what agents have recorded
(`STATUS_SQL`, `db/leads.ts`), so it stays true as the state machine and the
agents move things on.

A lead's life, in order:

```
Awaiting reply -> Answering -> Ready -> Working -> Closed
```

with Offers, Not interested, Needs review, Expired and Opted out as the other
ways the SMS part can end.

| Status | Tab | Condition |
|---|---|---|
| `opted_out` | Opted out | A live `dnc_list` row for the phone, or newest conversation `suppressed` |
| `closed` | Closed | An agent pressed Closed, and nothing has reopened it since ("Closed", below) |
| `working` | Working | An agent holds it, or has left a trace on it ("Working", below) |
| `needs_review` | Needs review | Conversation `review` |
| `offers` | Offers | The flow ended with the lead asking for special offers only (`end_outcome = 'offers'`). Not Ready: there is no call to make |
| `declined` | Not interested | The lead said No to the first question, then No thanks to the offers and to a rep (`end_outcome = 'declined'`). Nothing to do, and out of the queue. They have not opted out |
| `ready` | Ready | Conversation `completed` - the questions are finished, or the lead asked to hear from a rep - and no agent has touched it |
| `expired` | Expired | Conversation `expired` |
| `answering` | Answering | Conversation `open` and at least one question answered (a row in `conversation_answers`) |
| `awaiting_reply` | Awaiting reply | Conversation `open`, nothing answered |

The first match wins, in the order of rule 1. A lead with no conversation yet
has no status (`null`).

**The status follows the conversation, not the message log.** A lead moves to
Answering or Ready because the state machine saved an answer, not because a
message arrived. A reply the flow does not act on - one from a lead with no
conversation - leaves Awaiting reply, which is the honest answer. A lead whose
questions a phone call stopped (`STATE-MACHINE.md` rule 2d) keeps the status and
Step it had - Awaiting reply or Answering, at its question - until it expires,
unless an agent's trace makes it Working; its card says "Stopped at Q1 by a
call".

**A lead who sent STOP and later START still reads Opted out.** The block itself
is lifted - `dnc_list` has it released, and the lead can be texted and called -
but the conversation STOP ended stays `suppressed`, and this page reads that as
Opted out. The queue has it right: Inbound reply, for a person. Left as it is
(Decisions); if it is ever changed, it is the first line of `STATUS_SQL`:
`opted_out` would need a live block.

### Closed

An agent presses **Closed** in Wrap up (`AGENT-WORKSPACE.md`, "Dispositions").
The lead is closed while its newest disposition is `closed` - or `sold`,
`not_interested` or `wrong_number`, the retired values that meant the same
(`CLOSING_DISPOSITIONS`, `core/dispositions.ts`), so a lead closed under the old
list still reads Closed - and nothing has reopened it. `dnc` is not a closing
outcome: it blocks the number, which is Opted out.

**Four things reopen a closed lead** - `CLOSED_SQL`, `db/lead-state.ts`, the one
definition the queue, this page and the lead card share:

| What | The lead | Closed again when |
|---|---|---|
| The lead texts us | Working, and back in the queue as an Inbound reply (`QUEUE.md`) | The reply is read - nobody presses Closed twice - unless an agent has picked it up |
| An agent picks it up again | Working: whoever holds a lead is working it | The holder saves an outcome, which releases it |
| The lead rings us and nobody answers | Working, and in the queue as a Missed call, until someone gets back to them - a call, a text, answering when they ring again, or a new outcome (`INCOMING-CALLS.md`, "A missed call") | Someone gets back to them |
| An agent books a callback after closing | Working - "actually, call me Friday" is not finished | The callback is done |

A callback booked before closing is marked done by the close itself, and Wrap
up does not allow one in the same Save (`AGENT-WORKSPACE.md`, "Closing a lead").

### Working

**It starts at the first trace an agent leaves** (`WORKED_SQL`) - usually picking
the lead - and lasts until an agent closes it, across every call, voicemail and
callback in between. Those details are the timeline's, not the status's. A trace
is any of:

- an active agent holding the lead;
- a note, a disposition, or an SMS of their own (`sent_by` set);
- a callback - booked by a person, or booked by the system for the agent a
  missed call rang;
- a call an agent placed, or answered - a robot call's transfer a person took
  included.

**Not a trace:**

- picking a lead and putting it back untouched - releasing clears `assigned_to`
  and `assigned_at`, so nothing happened to it and it reads Ready again;
- a claim by a deactivated agent - the queue ignores it too;
- our own automated messages;
- an incoming call nobody answered, taken by itself;
- an automated call nobody took (`AUTO-CALLS.md`);
- a call back Seri booked, even once an agent has taken it - picking the lead up
  is the trace (`CALLBACKS.md`).

Once a person is on a lead, that someone is handling it matters more than what
the conversation says: a needs-review lead an agent has noted, or an expired lead
that texted back and was picked, reads Working.

### Step

The question the lead is on now, which the state machine moves on after each
valid answer; **Done** once the questions are finished; a hyphen for an
opted-out conversation - blocked on arrival, or ended by STOP, a DNC outcome, or
a stop said on the automated call.

| Lead | Status · Step |
|---|---|
| Question 1 sent, no reply | Awaiting reply · Q1 |
| Answered Q1, being asked Q2 | Answering · Q2 |
| Finished the questions | Ready · Done |
| Answered Q1, then silent 7 days | Expired · Q2 - where they dropped off |
| Two unclear replies to Q1 | Needs review · Q1 |
| Said No to Q1, then silent on the offers question | Expired · Q1-a |

A question is named by its own key: "Q2" on the main line, "Q1-a" for a
sub-question, named after its parent (`core/questions.ts`; `FLOWS.md`, "Naming a
question"). The API's `step` is that text - `"Q2"`, `"Q1-a"` - or `"done"`, or
null; never worked out from the position, which is an order, not a number to
print. It is read from `conversations.current_question_id`, or for a row that
names none, the flow's question at that position (`stepLabel`).

### Call

A lead is on two tracks at once: the texts, which the status and Step follow,
and the automated call (`AUTO-CALLS.md`). So the call is a column of its own,
not a status or a tab - a lead can be **Awaiting reply** and **Voicemail left**
at the same time, and both are true.

| Call | Means |
|---|---|
| - | The robot has not called the lead |
| Calling now | Its call is going: ringing, asking, putting a "yes" through, or on hold |
| Said yes · taken | Said yes, and a person took the transfer - the lead reads Working |
| Said yes · nobody took it | Said yes, and nobody took it - first in the agents' queue as Wants a call until someone gets back to them |
| Callback booked | On a call Seri took, the lead picked a time for a person to call them - the callback is on the lead's page (`CALLBACKS.md`). Her booking alone does not make the lead Working |
| Link sent | Said no, then yes to the link, which was texted |
| Not interested | Said no twice |
| Voicemail left | A machine answered; the message was left after its beep |
| No response | Not understood twice, or silence |
| Hung up | Picked up, and hung up before the script ended |
| No answer | No person picked up - no answer, busy, a fax, or Twilio refused the lead's number |
| Opted out | Said stop, or pressed 9 - the number is blocked, so the status reads Opted out too |
| No result | No result an hour after the call was placed: its end never reached us (below) |

The words are the timeline's, capitalised - one list, `lib/call-results.ts`, for
both screens. "Said yes · taken" here; the timeline names who took it and how
long they talked (`TIMELINE.md`).

**Worked out, never stored**, like the status: `robotCallSql` in `db/leads.ts`
reads the lead's automated call - one per lead (`calls_one_automated_per_lead`),
the newest should a second try ever be allowed - and gives
`calls.script_result`. Every call that ends has one: set when the script ends,
by `settleAutomatedCall` at the call's end if it never did, or `unanswered` when
Twilio refused the lead's number. A call Twilio never placed for our own
account's reasons, or never confirmed (`not_placed`, `AUTO-CALLS.md`, "When
Twilio refuses"), is not the lead's call and is left out: with only those, the
lead reads Not called. One with no result is still going, unless its end never
reached us; no robot call lasts long - the hold line's own safety stop is 10
minutes - so an hour on it reads **No result**, never "Calling now" for ever. An
agent's own call is never the robot's.

**The filter** - "All calls" by default, then "Not called", then each value
above in the order a call goes. `?call=` takes `none` or a value - `calling`,
`transferred`, `transfer_missed`, `callback_booked`, `link_sent`,
`not_interested`, `voicemail_left`, `no_response`, `hung_up`, `unanswered`,
`opted_out`, `unknown` - and anything else is refused with 400 `invalid_call`.
It narrows the tab counts as Source and Received do, so with "Voicemail left"
chosen the tabs say how many of those leads are Awaiting reply, Working and so
on. Where automated calls are off, every row reads "-" and the filter finds
nothing but "Not called".

### Filters

`GET /api/admin/leads?status=&source=&since=&call=&q=&page=`

| Parameter | Takes | Refused with |
|---|---|---|
| `status` | One of the ten statuses; absent, empty or `all` is every status | 400 `invalid_status` |
| `source` | A comma-separated list of any values, each matched exactly - `all` included | 400 `invalid_list` only for a value that is not text |
| `since` | `1h`, `24h`, `7d`, `30d`; absent, empty or `all` is no limit | 400 `invalid_since` |
| `call` | `none` or a Call value ("Call", above); absent or empty is every lead. `call=all` is refused | 400 `invalid_call` |
| `q` | Name, or phone in any punctuation | 400 `invalid_q` when given twice |
| `page` | A whole number from 1 to 100,000 (`parsePage`); absent is 1 | 400 `invalid_page` |

An unknown value is refused and the query never runs, so a typo in a filter
shows as an error, not as the wrong list. `since`, `source` and `q` go through
the same parsers as the queue (`api/filters.ts`).

Search matches name, or phone with punctuation stripped, so `(602) 555-0147`
finds `+16025550147`. What is typed is escaped before it reaches `LIKE`
(`leadSearchSql`, `db/sql.ts`), so a `%` or `_` is that character, not a
wildcard.

### The response

The types are `AdminLeadPage` and `AdminLeadRow` in `db/leads.ts`, copied in
`frontend/src/api/admin.ts`.

| Field | |
|---|---|
| `leads` | The page's rows, newest arrival first. Each: `id`, `phone` (E.164), `firstName`, `lastName`, `source`, `receivedAt`; `status` (one of the tabs - null when none applies, a lead with no conversation yet); `step` ("Q2", "Q1-a", `done`, or null when opted out); `score`, `tier`; `lastActivityAt` and `lastActivityDirection` (`inbound`, `outbound`) - the newest text either way, a send EZ Texting refused left out; `call`, the robot's call, null when it has not called |
| `counts` | One number per status tab, and `all`. They ignore `status` and honour every other filter, so each tab shows what it would hold |
| `total` | The rows the current tab holds - `counts[status]`, or `counts.all` |
| `page`, `pageSize` | The page shown and its size: 50 rows, which the route does not let the request change |
| `sources` | Every source any lead has, for the Source filter - not only this page's |
| `poll` | `at`, the worker's last successful poll, and `intervalSeconds`, its interval - the "Synced with EZ Texting" line ("The page", below) |

**Score and tier are the running values**, returned at every stage. Scoring
starts at the first reply, so a lead partway through has a real score - 10 for
responding, 30 once question 1 is answered Yes (still 10 after No) - and a tier
that follows it: a superadmin watching the flow sees a lead gather points. A
score of 0 returns null rather than `0`, so the column reads "-": zero means no
reply yet, and printing it reads as a judgement rather than an absence.

### The SQL

`listAdminLeads` runs two statements. The tab counts come first, from a query
that applies every filter except status - so switching tabs does not change the
numbers beside them - and never looks up a message, since nothing in them needs
one. Then the page: its rows are picked first - filter, order, limit - and only
then does each of its fifty rows look up its last message, the question it is
on and the robot's call. The newest conversation and the last message are
lateral joins, so the result stays one row per lead however much history
accumulates.

### How fast it is

A lead's status is worked out, not stored, so the page's cost grows with every
lead ever received - as the queue's does (`QUEUE.md`, "How fast it is", where the
index and the `jit` setting are). With 50,000 leads (`npm run speed`) the first
page reads in about 85 ms, one status tab about 160 ms and a late page about
125 ms; filtering on one call result asks every lead, one look-up each by the
one-call-per-lead index, about 40 ms. History has each measurement. What keeps it
there, besides the queue's fixes:

- two statements, not three - the total is read from the tab counts;
- the counts look up no message;
- the page picks its rows first and then looks up fifty rows' details - the Call
  column is one of those, so it costs nothing on an ordinary page;
- leads are indexed by when they arrived (migration 013), so an unfiltered page
  reads only its own rows instead of sorting every lead;
- "has this lead answered anything?" is one look-up for that conversation, not a
  read of every answer ever given.

### The page

One card holds the status switcher (with each tab's count), then the search and
filters - Source, Call, Received - then the table, under the same grey header
band as the queue, and built from the queue's own parts - `StatusIcon`,
`LiveStatus`, `LeadStatus`, `TierSignal` - so the two cannot drift
(`FRONTEND-STYLE.md`):

- **The status tabs** are the shared segmented switcher in its `dense` variant: an
  option never wraps, and a row wider than its card - a narrow screen, or counts in
  the thousands - scrolls sideways inside the card, never the page
  (`FRONTEND-STYLE.md`, "The segmented control").

- **Columns:** Tier, Lead (the phone under the name), Status, Step, Call, Score,
  Source, Received, Last activity.
- **Tier** as signal bars and the word (`TierSignal`); **Score** a plain bold
  number, right-aligned; **Status** an icon and the words (`LeadStatus`, on the
  queue's `StatusIcon` set). An opted-out row has its status in red; the row
  itself is plain.
- **The status icons follow a lead's life** - a clock, a chat bubble, then an empty,
  a half-filled and a ticked circle (`FRONTEND-STYLE.md`, "Status icons"). Closed,
  Expired, Offers and Not interested are muted: nothing is left to do on those
  leads.
- **A row opens the lead's timeline**, read-only; the lead's name is a link to it,
  so a row opens from the keyboard.
- **The header** says "Live · updated just now", as the queue does
  (`LiveStatus`).

**It refreshes every 5 seconds**, in place rather than behind a spinner, so the
table does not blank out; a switch of tab, filter, page or search keeps the old
rows on screen, faded and unclickable, until the new ones land (`FRONTEND.md`,
"The polling hook"). Rows new since the previous fetch get a 600 ms highlight - but not on the
first load, when everything is new and the whole table would flash, and not on
the first load of another view: a tab, a filter, a page or a search is another
list, not new rows.

**The EZ Texting sync line.** Under "Live · updated just now" sits "Synced with
EZ Texting 1m ago": the last time the worker polled for new leads, from the
poll checkpoint, which the poller writes on every successful poll (`POLLER.md`).
The interval is read as the worker reads it (`pollIntervalSeconds`,
`db/sql.ts`): 30 seconds unless the setting is above 0. After three poll
intervals without a poll - the spec's signal that the worker has stopped - it
turns amber and reads "Last synced with EZ Texting 2h ago - check the worker"
("Not synced with EZ Texting yet - check the worker" when there has been no
poll). Hovering shows the exact time. `components/SyncStatus.tsx`.

**The view is in the address** (`frontend/src/lib/leads-view.ts`): the tab, the
source, the call, the time window, the search and the page number are read from
the page's address and written back to it - `/admin/leads?status=answering&page=2`.

- Back from a lead's timeline returns to the same tab, filters, search and page.
- A default is left out, so the plain page is `/admin/leads`.
- Changing the view replaces the address rather than adding to the history, so
  Back from the list leaves it instead of stepping through every tab clicked.
- Anything unrecognised in the address reads as its default and never reaches the
  server - except the source, which is passed as it is.
- The Leads link in the side menu opens the plain page, on All.

The DNC list keeps its view in the address the same way (`ADMIN.md`, "DNC
list"); the queue and My Callbacks keep theirs in memory and start over.

## Rules

1. **The first status that applies wins, in this order:**
   1. `opted_out` - a blocked number wins over everything, checked against
      `dnc_list` as well as the conversation, because a phone can reach that list
      without ever holding one. A lead closed and then blocked reads Opted out.
   2. `closed` - before Working, because a closed lead has always been worked.
   3. `working` - before every SMS status: once a person is on a lead, that
      someone is handling it matters more than what the conversation says.
   4. The conversation: `needs_review`, `offers`, `declined`, `ready`,
      `expired`, then an open one split on whether any question has been
      answered - `answering`, else `awaiting_reply`.
2. **Nothing is stored.** The status, the Step and the Call column are worked
   out on every request.
3. **Closed and Worked are defined once**, `CLOSED_SQL` and `WORKED_SQL` in
   `db/lead-state.ts`, and the queue uses the same definitions - so a lead Closed
   here is never in the queue for a scored reason, and the two screens cannot
   disagree.
4. **A lead someone holds is never closed.** `CLOSED_SQL` excludes a lead with an
   active holder; saving an outcome releases it, and it reads Closed again.
5. **A closed lead is reopened only by the four things in "Closed"** - a text, a
   pick-up, an unreturned missed call, or a callback booked after closing.
6. **Only the newest conversation counts**, as on the queue.
7. **A bad filter is refused with a 400**, never read as no filter.

## Data

Reads `leads`, the newest row of `conversations`, `conversation_answers`,
`flow_questions`, `dnc_list`, `dispositions`, `notes`, `callbacks`, `calls`,
`messages`, `users`, and the `ezt_poll_checkpoint` and `poll_interval_seconds`
rows of `settings`; writes nothing - `SCHEMA.md`.

## Code

| File | What it does |
|---|---|
| `backend/src/api/admin/leads.ts` | `GET /api/admin/leads`, superadmin only: `parseStatus`, `parseCall`, and the shared parsers; adds `sources` and `poll` |
| `backend/src/db/leads.ts` | `STATUS_SQL`, `robotCallSql`, `listAdminLeads`, `stepLabel`, `listLeadSources`, `lastPollAt` |
| `backend/src/db/lead-state.ts` | `CLOSED_SQL`, `WORKED_SQL`, `MISSED_CALL_SQL` - shared with the queue and the lead card |
| `backend/src/core/questions.ts` | `questionShort`: "Q2", "Q1-a" |
| `frontend/src/pages/admin/LeadsPage.tsx` | The page |
| `frontend/src/lib/leads-view.ts` | The view in the address: `readLeadsView`, `writeLeadsView` |
| `frontend/src/lib/call-results.ts` | The Call column's words, shared with the timeline |
| `frontend/src/components/LeadStatus.tsx`, `frontend/src/components/SyncStatus.tsx` | A status's icon and words; the EZ Texting sync line |

## Tests

| What | Where |
|---|---|
| Every SMS status, each kind of agent trace on its own, Closed and a lead closed under a retired value, reopening by a later callback or a text, the tab counts; the Call column - each result, two tracks at once, a "yes" taken reading Working, Calling now and No result by the call's age, a lead never called and an agent's own call reading nothing, the filter alone, with a tab and with the counts, and Not called; a call back Seri booked - Callback booked, not Working, and its filter; each row of the Step table | `scripts/admin-leads-live-check.ts` |
| A missed call reopening a closed lead, and an outcome settling it | `scripts/calls-live-check.ts` |
| A lead someone holds is never closed | `scripts/dispositions-live-check.ts` |
| The route: superadmin only, each filter refused with its 400 | `api/__tests__/admin-leads.test.ts` |
| The view read from and written to the address: the round trip, defaults left out, anything unrecognised read as the default - the Call filter included | `lib/leads-view.test.ts` |
| The robot's call in words: the Call column's, the timeline's capitalised, and the Call filter's choices | `lib/call-results.test.ts` |
| The EZ Texting sync line, quiet and amber | `components/SyncStatus.test.tsx` |
| Speed with 50,000 leads | `npm run speed` - `backend/scripts/speed-check.ts` |

## Not done

- **The Source filter is single-select.** The brief asks for multi-select; the
  API already takes a comma-separated list.
- **Polling, not push.** Five seconds is often enough at 50-100 leads a day; if
  the screens ever move to a push, this page follows (`FRONTEND.md`, "The polling
  hook").
- **A lead who sent STOP, then START, reads Opted out** - by decision.
- **Status is worked out, not stored**, so the read grows with every lead ("How
  fast it is").

## Decisions

| Decision | By | Date |
|---|---|---|
| A status for a lead's whole life, not just its texts: Awaiting reply -> Answering -> Ready -> Working -> Closed, worked out from what agents have recorded, nothing stored | Jeel | 2026-09-28 |
| `in_progress` (In progress) renamed `answering` (Answering) - the queue's "In progress – name" meant an agent holding the lead; `completed` (Completed) renamed `ready` (Ready) - "Completed" read as finished when the calling had not started, and "Ready to call" read as an instruction | Jeel | 2026-09-28 |
| A lead an agent picks up again is Working, not Closed: a lead someone holds is never closed | Jeel | 2026-09-29 |
| Step is the question the lead is on now, not the highest answered | Jeel | 2026-09-29 |
| A lead who sent STOP, then START, keeps reading Opted out - seen on the real-phone walk, left as it is | Jeel | 2026-10-06 |
| The page redesigned to match the queue: one card, the queue's switcher and parts | Jeel | 2026-09-28 |
| The EZ Texting sync line, "Synced with EZ Texting 1m ago", in place of the yellow "No new leads pulled since ... - check the worker" box | Jeel | 2026-09-28 |

## History

- 2026-11-27 · Rewritten to the area standard: dated notes to this History, decisions to a table, the status precedence as numbered rules; the line that production had no robot calls "until `AUTO_CALLS` is on" corrected - automated calls are on in production since 2026-10-30; the queue's membership list replaced by a link to `QUEUE.md`; merged in: the page's switcher and tests from `FRONTEND.md` · docs standard · D18, D27
- 2026-11-23 · The response written down: its fields, and the types `AdminLeadPage` and `AdminLeadRow` · review R14
- 2026-11-22 · Rows new since the previous fetch flash only within one view: the record of rows seen kept every id ever shown, and every switch flashed the new view's rows · review M30
- 2026-11-22 · The sync line reads the poll interval as the worker does (`pollIntervalSeconds`): it fell back to 60 and took 0 at its word · review M17
- 2026-11-22 · `?page=` capped at 100,000 by the shared `parsePage`. It had reached the statement as whatever it parsed to - `2.5` skipped 75 rows, `1e30` was a 500 · review M17
- 2026-11-13 · A call back Seri booked: Callback booked in the Call column and its filter, after the two "yes" values; her booking alone is not Working · A15
- 2026-10-25 · The Call column after Step, and a Call filter between Source and Received - how the robot's call went. Timed, the code before and after: the first page 82 and 86 ms, one status tab 159 ms both times, a late page 124 and 123 ms; filtering on one result 39 ms · T23
- 2026-10-24 · Faster with no change to this page: "Closed" asks whether the lead has a missed call nobody returned, and that rule now lets Postgres work the missed calls out once per statement (`QUEUE.md`, History, T22): one status tab 175 to 156 ms, a late page 151 to 125 ms, the first page 92 to 84 ms, robot calls included · T22
- 2026-10-11 · The view kept in the address (`leads-view.ts`). It had been held in the page's memory, so on the Answering tab, opening a lead and pressing Back put the list on All again, page one, every time - found in the first week of real use, working down a tab one lead at a time · Jeel
- 2026-10-06 · Offers made ten tabs and Not interested eleven; with three-digit counts they no longer fitted at any width up to the 1440px the content is capped at, and "Awaiting reply" broke onto two lines inside its 32px track. The switcher's `dense` variant (12px sides instead of 16), options that never wrap, and a row that scrolls in its card - measured in `FRONTEND-STYLE.md`'s History · review
- 2026-10-06 · Timed against 50,000 leads: every lead, first page 3.3 s before, 0.18 s after; one status tab 5.7 and 0.34 s; a late page 5.1 and 0.27 s; a name search 0.07 and 0.03 s. Two statements, not three; no message looked up for the counts; the page's rows picked first; leads indexed by arrival (migration 013); "answered anything?" one look-up · migration 013
- 2026-10-06 · Step by the question's own name. It was the bare position, and the antibiotics flow's offers question - asked only of a lead who said No to question 1 - read "Q4", as if they had answered three; the API's `step` became text (`"Q2"`, `"Q1-a"`, `"done"`) rather than a number · flows
- 2026-10-06 · `declined`, Not interested: a lead who said No, then No thanks to the offers and to a rep · flows
- 2026-10-05 · `offers`, Offers: a lead who asked only for special offers - not Ready, since there is no call to make · Phase 5, flows
- 2026-10-01 · A missed call nobody returned reopens a closed lead, as Working, until someone gets back to them · Phase 4
- 2026-09-29 · A closed lead an agent picks up again reads Working. Until then it read Closed the moment its reply was read, while the queue showed "Working – Maya" · Jeel
- 2026-09-29 · Step became the question the lead is on now. It was the highest question *answered*, so it read one behind - "Answering · Q1" for a lead already past Q1, "Ready · Q3" for one who had finished - and said nothing about where a lead that stopped had stopped. The API field `stepReached` (a number) became `step` (then `1`-`3`, `'done'` or null); `conversations.step` already held it, so no database change · Jeel
- 2026-09-28 · Working and Closed added. The status had described only the SMS conversation: a lead that answered all three questions read Completed forever - untouched, called five times or finished alike - and, since nothing recorded that a lead was finished, it went back into the queue at the top for the next agent to call. `in_progress` and `completed` renamed with their labels; `?status=in_progress` and `?status=completed` are refused with a 400, as any unknown status is. For part of the day there were three closing outcomes - Sold, Not interested, Wrong number - shown as "Closed – Sold"; leads closed under them still read Closed · Jeel
- 2026-09-28 · Working and Closed made nine tabs, and the ninth wrapped onto a second line below 1366px; narrower tab sides kept all nine on one line down to 1280px, measured. Checked at 1280, 1366, 1440 and 1920px: all nine on one line, nothing overflowing the card, a row click opening the timeline, no console errors. The status tabs, underline tabs in the link blue, became the queue's navy switcher - Jeel: blue means the brand navy. `StatusIcon`, `LiveStatus` and `LeadStatus` moved out of the queue so both pages use them · Jeel
- 2026-09-28 · The page redesigned to match the queue - one card, the queue's segmented switcher in navy, signal bars, status icons and words, "Live · updated just now". Before: tabs, filters and table loose on the page; underline tabs in the link blue; columns Received, Lead, Phone, Source, Status, Step, Score, Last activity; a HOT / WARM / LOW pill beside a coloured score; coloured status pills; an opted-out row tinted red; a header with the title only; rows not clickable. A row opens the lead's timeline from the same day - it had waited on that page existing · Jeel
- 2026-09-28 · The sync line replaced a full-width yellow box, "No new leads pulled since ... - check the worker", which looked generated, dominated the page, and was wrong: it read the checkpoint's `updated_at`, which the poller wrote only when a new contact arrived, so on a quiet account it said "check the worker" about a worker polling every minute - locally it had for six days. The poller writes the checkpoint on every successful poll since · Jeel
- 2026-09-28 · An unknown filter value refused with a 400. This route had read one as no filter while the queue refused the same `?since=`; both use `parseSince` in `api/filters.ts` since, where the viewer's `?tz=` check also lives. Search escaped for `LIKE` (`db/sql.ts`); until then this page did not escape at all, and `%` matched every lead · review
- 2026-09-22 · Score and tier shown at every stage. They had been hidden until `completed`, on the reasoning that a partial score next to a final one invites comparing them; that cost more than it saved - a superadmin watching the flow could not see a lead gathering points
- 2026-09-21 · The status follows the conversation. Until then nothing advanced the conversation, so a lead who had replied still read `awaiting_reply`, and only the inbound arrow in Last activity showed it
- 2026-09-14 · Admin > Leads added to the plan, not in the original: every lead, with status tabs, filters, search and pages · Week 3 item 10
