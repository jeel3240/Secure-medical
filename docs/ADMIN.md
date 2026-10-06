# Admin screens

The superadmin area: Overview, Configuration, DNC list. Phase 3.

Admin > Leads has its own doc, `ADMIN-LEADS.md`, and Agents is covered by
`AUTH.md`. Screens: `DESIGN-PROMPT.md` section 6.

**Admin is read-only except Agents - decided by Jeel, 2026-09-23.** Scoring
rules, tier bands, message copy, expiry and the DNC list are shown, not edited.
The reasoning and the full before/after are in CLAUDE.md §10, "Phases, and what
Phase 3 is". Changes go through a numbered migration and a PR.

**Built 2026-09-26** (Phase 3 tasks 10, 11 and 12): all three endpoints -
`api/admin/config.ts`, `api/admin/overview.ts`, `api/admin/dnc.ts`, over
`db/admin-config.ts`, `db/admin-overview.ts`, `db/admin-dnc.ts`. The screens
themselves are tasks 23, 24 and 25. Every route is superadmin only and has no
POST, PUT, PATCH or DELETE - tests assert that, so read-only stays a decision
rather than something that erodes.

## Configuration (new page, replaces 6b and 6c)

One page, because neither half has actions any more and they are read together:
here is what we ask, here is what each answer is worth.

- Every text a lead can receive, as it is sent, each with its character and
  segment count so it is obvious when one costs two segments.
- The scoring table: response, completion, and the points for each choice of
  each question, with the maximum possible.
- The tier bands.
- Conversation expiry, read from `settings.expiry_days` - 7.

`GET /api/admin/config` returns all of it from the flow new leads get
(`flows`, `flow_questions`, `flow_choices` - `FLOWS.md`), `settings` and
`tiers`, so the page always shows what the state machine is actually using
rather than a copy in the frontend. That is the point of the page: not
documentation of what we intended, but a window on live values.

**As built.** Each message carries `length`, `worstCaseLength`, `segments` and
`costsExtraSegment`. The worst case matters more than the stored length: an
opener holding `{first_name}` is a different length for every lead, so the
count is taken against the longest first name currently in the `leads` table -
returned as `longestFirstName` - or the `there` fallback when that is shorter,
with `longestNameIsFallback` set so the page says which it is rather than
showing "there" as a name (2026-09-29).

**The messages are listed as a lead receives them** (2026-10-05): the first
question; then, for every choice, its reply joined to the question that
follows - one text, which is how it is sent; then each question's "sorry"
text, the review text, and the text after a missed call. Sixteen for the
antibiotics flow. Each carries a `name` ("After Q1 · Yes") and `when` ("Then
Q2", "Ends the questions"), built by the server, since the list depends on the
flow. Two of them run past 160 characters and are flagged as two segments.
The card's heading names the flow.

*(Until then: nine fixed messages - three questions, three clarifications, the
review text, the thanks and the missed-call text.)*
A message that fits in one segment for "Jo" and not for "Christopher" is one
that costs two segments for some leads, and the page has to show that.

`message_stop` is not returned. EZ Texting sends the unsubscribe confirmation
and we never do - `STATE-MACHINE.md` rule 1 - so listing it among our copy
would misrepresent what goes out. It stays seeded in `settings` in case the
account's own handling is ever switched off.

`maxScore` is computed from the rows, not fixed at 100, so an edited rule shows
up on the page instead of quietly disagreeing with the tier bands beneath it.

**No Save, no Recalculate.** A rule change therefore leaves existing leads on
their old scores. Accepted - CLAUDE.md §10.

**The page, redesigned - Jeel, 2026-09-28: "too messy".** Four cards in the
style of the other admin pages, each with a title row:

| Card | Shows |
|---|---|
| Messages | One row per message: its name and when it is sent on the left ("Question 2 · After answer 1"), the copy in normal type on the right, and "88 characters · 1 segment" under it. `{first_name}` shows as a small "first name" chip. A message that costs a second segment for some leads says so in amber |
| Scoring | Plain rows - "Replied at all +10", then each question's options grouped under it - and a shaded Maximum row |
| Tiers | The queue's signal bars and each band |
| Settings | Expiry, clarifications before review, the segment limit |

Gone: the blue "changed through a migration" box (now one clause of the
subtitle), the copy in a code font on grey, the upper-case row labels, the
coloured tier pills, and three paragraphs of notes - each card's one caveat is
a quiet line at its foot. The header has "Live · updated just now".

**"Clarifications before review", not "Unclear replies before review".** The
setting is 1, and it counts clarifications: the first unclear reply is
clarified, the second goes to review. The old label read as one unclear reply
being enough.

## Overview (6a)

`GET /api/admin/overview?period=today|7d|30d`

Four totals, a per-agent table, the system checks and a recent activity feed,
all derived from the existing tables. Nothing here is stored as a running
total; at 50-100 leads a day the queries are cheap and a stale counter is worse
than a slow one.

**Rebuilt, and made smaller - Jeel, 2026-09-28: "we are making the system
complex".** The page and the API now hold only what a superadmin acts on:

| Part | Shows |
|---|---|
| Totals | Leads in · Replied · Answered all 3 · Closed - for Today, 7 days or 30 days, chosen on the navy switcher |
| Agents | Per active agent: **Working now** (leads they hold), **Closed** in the period, **Due today**, **Last active** (their newest note, callback they booked, outcome, call they placed or answered, or SMS that went out) |
| System | Database, EZ Texting sync, the expiry sweep, sending and calling - each OK or Degraded - and incoming replies, which shows its last reply with no verdict. Calling is Degraded when the phone number or the TwiML App no longer points at this server (2026-10-02), and reads "not set up", with no verdict, where calling is off. From the health endpoint |

**Every number counts what happened in the period - Jeel, 2026-09-28, "i want
all real":**

| Number | Counts |
|---|---|
| Leads in | Leads that arrived from EZ Texting in the period |
| Replied | Leads whose **first** reply came in the period. A lead from yesterday who first replies today is today's; one writing again weeks later is not counted twice |
| Answered all 3 | Leads whose third answer came in the period - `conversations.completed_at`, migration 004 |
| Closed | **Leads** closed in the period, not presses of Closed: a lead closed, reopened by a text and closed again is one |
| Working now | Leads the agent holds right now, whatever the period |
| Due today | The agent's open callbacks due **by the end of today**, in the viewer's time zone, overdue ones included - one booked for next week is not. Until 2026-09-29 it counted only those already due, so a 3 PM callback showed nothing all morning; the column was called Callbacks due |

Until that day Replied and Answered all 3 counted leads that *arrived* in the
period, Closed counted presses, and Callbacks due counted every open callback;
the percentages under Replied and Answered all 3 went with the first fix, since
a share of "leads that arrived" no longer applies.

**A failing check is shown in the System card, not across the page** - Jeel,
2026-09-28. The card's header turns amber ("Needs attention") and the failing
row says why in one amber line under its name - "The last text was refused by
EZ Texting." There is no red box above the page any more: it repeated the
card, louder, and looked generated.

**Switching period is smooth.** The page stays and its numbers fade until the
new ones land - `usePolling`'s `keepPreviousData`, QUEUE.md - rather than
blanking for a spinner. Checked by sampling the page every 20ms through a
switch: it never went blank.

**Recent activity** sits under the cards: "karm closed Omar Haddad", newest
first, the lead's name linking to its timeline.

**Removed:** the funnel, which drew the same numbers as the cards as bars; the
HOT, Callbacks set and DNC added cards; and every call figure - Calls made,
Reached, average call length - with `callsBuilt`, which only said they were
zero. The per-agent outcome breakdown ("Callback set 1Closed 2No answer 3")
went too: outcomes are Closed and DNC now, and Closed has its own column. None
of it is computed any more. Phase 4 can add call figures back if the client
wants them.

Closed counts `closed` and the retired `sold`, `not_interested` and
`wrong_number`, so leads closed under the old list still count
(`AGENT-WORKSPACE.md`, "Dispositions").

**Live system status** - last poll, last inbound reply, worker health - comes
from the health endpoint in `LOGGING.md` rather than this route, so the screen
and that endpoint cannot disagree. The endpoint is superadmin-only, so nothing
outside can poll it - `README.md`, "Known limits".

The per-agent table and the activity feed are the only place one agent's work is
visible to anyone but themselves. Agents cannot reach this page: `AUTH.md`.

**"Today" is the viewer's day** - since 2026-09-28 the browser sends its time
zone as `?tz=`, and today starts at the viewer's midnight, not the database's
UTC one (`db/sql.ts`, `startOfTodaySql`). An invalid zone is a 400; none means
UTC.

**As built.** `period` defaults to `today`, which means since midnight rather
than the last 24 hours. Leads are counted by when they reached us
(`ezt_added_at`, falling back to `created_at`) - the same expression the queue
uses for a lead's age - while closings are counted by when they happened, so a
lead closed today about last week's lead lands in today's figures.

The activity feed is a four-way UNION over `dispositions`, `notes`, `callbacks`
and agent-sent `messages`, newest first, capped at 50. Agent actions only: the
automated flow is already visible per lead on the timeline, and this feed
answers "what are my agents doing". For the same reason a callback the system
books for a missed call (`callbacks.reason = 'missed_call'`) is not in the
feed, and neither it nor a call that only rang an agent moves their Last
active (2026-10-01).

## DNC list (6e)

`GET /api/admin/dnc?q=&page=&state=` - phone, reason, when it was added, the
lead if we hold one, and whether and why it was released. There is no "who
added it": `dnc_list` has no such column; the agent behind a DNC outcome is in
the activity log (`AUDIT.md`).

Read-only, and there is no manual add (Jeel, 2026-09-23): a number reaches the
list through an agent's DNC disposition, an SMS STOP, or an EZ Texting opt-out
found by the poller. `AGENT-WORKSPACE.md` has the disposition path,
`STATE-MACHINE.md` the SMS ones.

No delete, by design - the design brief calls it a compliance record. A number
can still be released by the lead texting START, which keeps the row and stamps
`released_at`: `STATE-MACHINE.md`, "Opting back in". The screen has to show
released rows as released rather than hiding them, or the list stops matching
who is actually blocked.

**The page matches Admin > Leads - Jeel, 2026-09-28.** One card: the queue's
navy switcher for All / Blocked / Released beside the search, then the table -
the lead's name with the number under it, the reason, when it was added, and
the state as an icon and words: **Blocked** in red with a barred circle,
**Released** muted with a tick and "Texted START · date" under it. A number
with no lead reads "No lead". A row with a lead opens its timeline. The blue
box explaining where numbers come from became a quiet note at the foot of the
card, and the header has "Live · updated just now".

**Search escaping was broken until 2026-09-28.** The DNC query's own copy of
the LIKE escape was a template literal that produced the text `${c}`, so a
`%` or `_` was never escaped, and its digits clean-up read `'D'` for `'\D'`,
stripping the letter D instead of every non-digit. Its check only proved `%`
matched nothing - which the broken version also did. All searches now use the
one escape in `db/sql.ts`, and `scripts/admin-live-check.ts` finds a name with
an underscore, which fails against the old code.

**As built.** `state` is `all` by default, and `all`, `blocked` or `released`
are the accepted values. Counts for all three come back whichever is asked for,
so a tab badge is right while another tab is open. Search takes digits only
when the query contains any, so `(555) 999-9999` finds `+15559999999`; a query
with no digits matches the lead's name instead. `%` and `_` are escaped, or a
search box holding one would match every row.

The lead join is `LEFT`: a number can be blocked before we ever hold a lead for
it - the poller's check on a later partner delivery depends on exactly that -
and those rows are listed with `lead: null`.

Export CSV is in the design brief. Worth having, and cheap, but it hands a file
of phone numbers to a browser - a superadmin-only route, and not something to
add without Jeel saying so. Not built.

`scripts/admin-live-check.ts` proves all three read models against a real
database: the config against the rows seeded by `001_init.sql` and against an
edited rule, the overview's period windows, totals, per-agent aggregates and
activity feed,
and the DNC list's states, search escaping and lead-less rows.
