# Admin > Leads

Every lead the poller has pulled in, whether or not they replied. Superadmin
only, read-only.

Spec: `DESIGN-PROMPT.md` section 6g. Code: `frontend/src/pages/admin/LeadsPage.tsx`,
`backend/src/api/admin/leads.ts`, `backend/src/db/leads.ts`.

## Why it is separate from the queue

The Priority Queue shows only leads who replied, because agents should spend
their time on people who texted back. This page shows everyone, so a superadmin
can confirm leads are arriving and see where they drop off, without
non-responders burying HOT leads in the agents' view.

## Status is derived, never stored

There is no status column on `leads`. Each row's status is computed from the
lead's newest conversation, so it stays correct as the state machine advances
things later.

| Status | Condition |
|---|---|
| `opted_out` | On `dnc_list`, or newest conversation `suppressed` |
| `needs_review` | Conversation `review` |
| `completed` | Conversation `completed` |
| `expired` | Conversation `expired` |
| `in_progress` | Conversation `open` and at least one of q1-q3 answered |
| `awaiting_reply` | Conversation `open`, nothing answered |

Order matters. `opted_out` is checked first so it wins over any conversation
state, and against `dnc_list` as well as the conversation, because a phone can
reach that list without ever holding one.

**A reply alone does not move a lead off `awaiting_reply`.** The status follows
the conversation, not the message log. Until the state machine reads an inbound
message and writes `q1`, a lead who has replied still reads as awaiting - the
inbound arrow in Last activity is what shows the reply arrived. This is correct
rather than a bug, but it surprises people.

## The query

`GET /api/admin/leads?status=&source=&since=&q=&page=`

Newest conversation and newest message are both lateral joins, so the result
stays one row per lead however much history accumulates. Tab counts come from a
second query that applies every filter except status, so switching tabs does not
change the numbers beside them.

Search matches name, or phone with punctuation stripped, so `(602) 620-3572`
finds `+16026203572`.

Score and tier are returned only for `completed` leads; a partial conversation
has a score, but showing it next to a completed one would invite comparing them.

## The page

Refreshes every 5 seconds. The timer refetches in place rather than showing a
spinner, so the table does not blank out; only a filter change clears it.

Rows that are new since the previous fetch get a 600ms highlight. Everything is
new on the first load, so that case is deliberately excluded - otherwise the
whole table flashes on arrival.

Rows are not clickable yet. The spec has them opening the Lead Timeline, which
does not exist.

A banner appears when the poller's checkpoint has not moved in three poll
intervals, which is the spec's signal that the worker has stopped.

## Not done yet

- **No row click.** Waiting on the Lead Timeline page.
- **Source filter is single-select.** The spec asks for multi-select; the API
  already accepts a comma-separated list.
- **Polling, not push.** Five seconds is frequent enough at 50-100 leads a day,
  but it is a poll. If the queue screen later uses something better, this should
  follow it.
