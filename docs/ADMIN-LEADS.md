# Admin > Leads

Every lead the poller has pulled in, whether or not they replied. Superadmin
only, read-only.

Spec: `DESIGN-PROMPT.md` section 6g. Code: `frontend/src/pages/admin/LeadsPage.tsx`,
`backend/src/api/admin/leads.ts`, `backend/src/db/leads.ts`.

## Why it is separate from the queue

The Priority Queue shows only leads who need a person - completed, needs
review, an inbound reply, or one being worked - because agents should spend
their time on people who have given them a reason to. *(2026-09-28: a lead
partway through the questions is no longer in the queue, so this page, under
Answering, is the only place it appears.)* This page shows everyone, so a superadmin
can confirm leads are arriving and see where they drop off, without
non-responders burying HOT leads in the agents' view. That list is `QUEUE.md`.

## Status is derived, never stored

There is no status column on `leads`. Each row's status is computed from the
lead's newest conversation and from what agents have recorded, so it stays
correct as the state machine and the agents move things on.

**A lead's whole life, in order - Jeel, 2026-09-28:**

```
Awaiting reply -> Answering -> Ready -> Working -> Closed
```

with Needs review, Expired and Opted out as the other ways the SMS part can end.

| Status | Tab | Condition |
|---|---|---|
| `opted_out` | Opted out | On `dnc_list`, or newest conversation `suppressed` |
| `closed` | Closed | An agent pressed Closed, and nothing has reopened it since: no unread text from the lead, no callback booked after it |
| `working` | Working | An agent holds it, or has left any trace on it: a note, a callback, a disposition, a call, or an SMS of their own |
| `needs_review` | Needs review | Conversation `review` |
| `ready` | Ready | Conversation `completed` - answered all three - and no agent has touched it |
| `expired` | Expired | Conversation `expired` |
| `answering` | Answering | Conversation `open` and at least one of q1-q3 answered |
| `awaiting_reply` | Awaiting reply | Conversation `open`, nothing answered |

The first match wins, so the order is the rule:

- **`opted_out` first**, so a blocked number wins over everything, checked
  against `dnc_list` as well as the conversation, because a phone can reach
  that list without ever holding one. A lead closed and then blocked reads
  Opted out.
- **`closed` before `working`**, because a closed lead has always been worked.
- **`working` before every SMS status.** Once a person is on a lead, that
  someone is handling it matters more than what the conversation says. A
  needs-review lead an agent has noted, or an expired lead that texted back and
  was picked, reads Working.

Closed and worked are defined once, in `backend/src/db/lead-state.ts`, and the
queue uses the same definitions - so a lead Closed here is never in the queue,
and the two screens cannot disagree.

### Why Working and Closed were added - 2026-09-28

Until then the status described the SMS conversation only. A lead that
answered all three questions read **Completed** forever: untouched, called five
times, or finished, all alike. And since nothing recorded that a lead was
finished, it went back into the queue at the top for the next agent to call.

Two renames came with it, so each word means one thing:

| Was | Is | Why |
|---|---|---|
| `in_progress`, In progress | `answering`, Answering | The queue's "In progress – karm" means an agent holds the lead. Two meanings for one phrase |
| `completed`, Completed | `ready`, Ready | "Completed" read as finished when the calling had not started. Briefly "Ready to call" the same day - Jeel: that reads as an instruction to call, so just Ready |

The API values changed with the labels. `?status=in_progress` or
`?status=completed` is now refused with a 400, as any unknown status is - see
"Filters" below. The screen keeps its filters in memory, not the address, so no
saved link carries the old values.

### Closed

**One button, one status - Jeel, 2026-09-28.** An agent presses **Closed** in
Wrap up; there is no reason to pick. For part of that day there were three -
Sold, Not interested, Wrong number - shown as "Closed – Sold", but the
requirement asks for no reason, so the note says why if anything does. Leads
closed under those three still read Closed. `dnc` is not a closing outcome
because it needs to be none: it blocks the number, which is Opted out.

**A closed lead that texts us is Working again.** Its message needs a person,
so it also returns to the queue as an Inbound reply (`QUEUE.md`). Once that is
read, it is Closed once more.

**A callback booked after closing makes it Working again**, until the callback
is done. One booked before closing, or in the same Save, does not.

### Working

**Starts at the first trace an agent leaves** - usually picking the lead. It
lasts until an agent closes it, across every call, voicemail and callback in
between. Those details are the timeline's, not the status's.

**Picking a lead and putting it back untouched is not Working.** Releasing
clears `assigned_to` and `assigned_at`, so no trace is left and the lead is
Ready again. That is deliberate: nothing happened to it.

**Not Working:** a claim by a deactivated agent (the queue ignores it too), and
our own automated messages - only an SMS with `sent_by` set is an agent's.

**The status follows the conversation, not the message log.** A lead who has
answered moves to `answering` or `ready` because the state machine
wrote `q1`, not because a message arrived.

Until 2026-09-21 nothing advanced the conversation, so a lead who had replied
still read as `awaiting_reply` and only the inbound arrow in Last activity
showed it. That is fixed. It can still happen for a reply the flow does not
act on - one that arrives with no conversation on the lead - and in that case
awaiting is the honest answer.

## The query

`GET /api/admin/leads?status=&source=&since=&q=&page=`

### Filters

Absent, empty or `all` means no filter. Anything else must be a known value, or
the request is refused with a 400 and the query never runs: `invalid_status`,
or `invalid_since` for a time window other than `1h`, `24h`, `7d` or `30d`.

Until 2026-09-28 this route silently read an unknown value as no filter, while
the queue refused the same `?since=` with a 400 - one filter, two behaviours.
Both now use `parseSince` in `api/filters.ts`, where the viewer's `?tz=` check
also lives. A typo in a filter now shows as an error, not as the wrong list.
`api/__tests__/admin-leads.test.ts` pins it.

### The SQL

Newest conversation and newest message are both lateral joins, so the result
stays one row per lead however much history accumulates. Tab counts come from a
second query that applies every filter except status, so switching tabs does not
change the numbers beside them.

What is typed is escaped before it reaches `LIKE`, so a `%` or `_` is that
character, not a wildcard - `db/sql.ts`, 2026-09-28; until then this page did
not escape at all, and `%` matched every lead.

Search matches name, or phone with punctuation stripped, so `(602) 620-3572`
finds `+16026203572`.

`scripts/admin-leads-live-check.ts` proves the statuses against a real
database: every SMS status, each kind of agent trace on its own, Closed and a
lead closed under a retired value, reopening by a later callback or a text,
and the tab counts. Last run 2026-09-28: 22 checks, all passing.

Score and tier are the running values, returned at every stage. Scoring starts
at the first reply, so a lead part-way through has a real score - 10 for
responding, 25 once question 1 is answered - and a tier that follows it.

They were hidden until `completed` (now Ready) until 2026-09-22, on the reasoning that a
partial score next to a final one invites comparing them. That cost more than
it saved: a superadmin watching the flow could not see a lead accumulating
points, which is the thing the page is for.

A score of 0 returns null rather than `0`, so the column reads `-`. Zero means
no reply yet, and printing it looks like a judgement rather than an absence.

## The page

**Redesigned to match the queue - Jeel, 2026-09-28.** One card holds the
status tabs, the search and filters, and the table, under the same grey header
band as the queue. Built from the queue's own parts, so the two cannot drift:

| Part | Was | Is |
|---|---|---|
| Layout | Tabs, filters and table loose on the page | One card: the status switcher, then search and filters, then the table |
| Status tabs | Underline tabs in the link blue | The queue's segmented switcher - the chosen status in the brand navy, sliding between options, with its count |
| Columns | Received, Lead, Phone, Source, Status, Step, Score, Last activity | Tier, Lead (phone under the name), Status, Step, Score, Source, Received, Last activity |
| Tier | A HOT / WARM / LOW pill beside the score | Signal bars and the word - `TierSignal` |
| Score | Coloured number | A plain bold number, right-aligned |
| Status | Coloured pills | An icon and the words - `LeadStatus`, on the queue's `StatusIcon` set |
| Opted out | Whole row tinted red | Its status in red; the row is plain |
| Header | Title only | "Live · updated just now", as on the queue - `LiveStatus` |
| Row | Not clickable | Opens the lead's timeline |

The status icons follow a lead's life: a clock for Awaiting reply, a chat
bubble for Answering, then an empty circle (Ready), a half-filled one (Working,
the same as the queue) and a ticked one (Closed). Needs review is the queue's
warning triangle, Opted out a barred circle in red, Expired an hourglass.
Closed and Expired are muted: those leads are finished.

Refreshes every 5 seconds. The timer refetches in place rather than showing a
spinner, so the table does not blank out; only a filter change clears it.

Rows that are new since the previous fetch get a 600ms highlight. Everything is
new on the first load, so that case is deliberately excluded - otherwise the
whole table flashes on arrival.

A row opens the lead's timeline, read-only (2026-09-28 - it waited on that page
existing).

**The EZ Texting sync line - Jeel, 2026-09-28.** Under "Live · updated just
now" sits "Synced with EZ Texting 1m ago": the last time the worker polled for
new leads. After three poll intervals without a poll - the spec's signal that
the worker has stopped - it turns amber and reads "Last synced with EZ Texting
2h ago - check the worker". Hovering shows the exact time.
`components/SyncStatus.tsx`.

It replaces a full-width yellow box, "No new leads pulled since ... - check the
worker". That looked generated and dominated the page, and it was also wrong: it
read the checkpoint's `updated_at`, which the poller wrote only when a new
contact arrived. On a quiet account it said "check the worker" about a worker
polling every minute - locally it had said so for six days. The poller now
writes the checkpoint on every successful poll (`POLLER.md`, step 7), so the
time is the last poll.

## Not done yet

- **Source filter is single-select.** The spec asks for multi-select; the API
  already accepts a comma-separated list.
- **Polling, not push.** Five seconds is frequent enough at 50-100 leads a day,
  but it is a poll. If the queue screen later uses something better, this should
  follow it.
