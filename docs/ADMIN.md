# Admin screens

The superadmin's Overview, Configuration and DNC list: windows on what the system
is doing and the values it is using, read-only but for one control, Seri's
switch. Admin > Leads has its own doc, `ADMIN-LEADS.md`, and Agents is in
`AUTH.md`. The routes are `backend/src/api/admin/config.ts`,
`backend/src/api/admin/overview.ts` and `backend/src/api/admin/dnc.ts`, over
`backend/src/db/admin-config.ts`, `backend/src/db/admin-overview.ts` and
`backend/src/db/admin-dnc.ts`; the screens are in `frontend/src/pages/admin/`
(brief: `DESIGN-PROMPT.md` section 6).

## How it works

Every admin route is superadmin only (`requireRole('superadmin')`) and answers
`GET`, but one: `POST /api/admin/config/ai-agent`, Seri's switch. Each screen
polls its route every 5 seconds and says "Live · updated just now" in its header.

### Configuration

One page shows what we ask, what each answer is worth and how the robot's call
goes, from `GET /api/admin/config` - one page, because none of it has actions and
it is read together. It reads the flow the one bucket's new leads get (`flows`,
`flow_questions`, `flow_choices` - `FLOWS.md`), `settings`, `tiers`, and the
automated call's script and settings, on every request - never a copy in the
frontend. That is the point of the page: not documentation of what was meant,
but a window on the values the system is using.

It returns:

- **Every text a lead can receive**, as it is sent, each with its character and
  segment count, so it is plain when one costs two segments. Two of the
  antibiotics flow's texts run past 160 characters and are flagged as two
  segments.
- **The scoring table:** replying, finishing, and the points for each choice of
  each question, with the maximum possible.
- **The tier bands.**
- **The flow settings:** conversation expiry, clarifications before review, the
  segment limit. Expiry is read from `settings.expiry_days` as every other reader
  takes it (`expiryDays`, `db/sql.ts`): 7 unless the setting is above 0.
- **The automated call's script and settings** ("The automated call", below).
- **Seri's switch**: whether it is on, and whether her key is set ("Seri's
  switch", below).

Its reads run one at a time, so a page polled every 5 seconds holds one of the
pool's ten connections, not eleven.

#### The messages

They are listed as a lead receives them: the first question; then, for every
choice, its reply joined to the question that follows - one text, which is how
it is sent; then each question's "sorry" text, the review text, the text after a
missed call, and last the automated call's link text (**Call · link**). Each
carries a `name` ("After Q1 · Yes") and a `when` ("Then Q2", "Ends the
questions"), built by the server, since the list depends on the flow. A question
is named by its key - "Q2", and "Q1-a" for a sub-question: "Then Q1-a", "Unclear ·
Q1-a" (`FLOWS.md`, "Naming a question"). The scoring card titles each question
the same way, with what it asks: "Q1-a · Offers". The Messages card's header names
the flow.

Each message carries `length`, `worstCaseLength`, `segments` and
`costsExtraSegment`. The worst case matters more than the stored length: an
opener holding `{first_name}` is a different length for every lead, so it is
counted against the longest first name in the `leads` table - returned as
`longestFirstName` - or the `there` fallback when no name is longer, with
`longestNameIsFallback` set so the page says which it is rather than showing
"there" as a name. A message that fits in one segment for "Jo" and not for
"Christopher" costs two for some leads, and the page has to show that.

`message_stop` is not returned. EZ Texting sends the unsubscribe confirmation
and we never do (`STATE-MACHINE.md` rule 1), so listing it among our copy would
misrepresent what goes out. It stays seeded in `settings` in case the account's
own handling is ever switched off.

`maxScore` is worked out from the rows, not fixed at 100, so an edited rule shows
on the page instead of quietly disagreeing with the tier bands beneath it.

#### Three tabs

The page is split in three on the navy switcher the other pages use, each tab in
two columns with the long list on the left:

| Tab | Cards |
|---|---|
| Texts | Messages, and Settings beside it |
| Scoring | Scoring, and Tiers beside it |
| Calls | Call script, and Calls beside it; Seri |

The tab is in the address - `/admin/config?tab=calls` - so a reload or a link
keeps it; Texts is the plain address, and anything else reads as Texts. Only
the screen is split: `GET /api/admin/config` returns everything at once.

| Card | Shows |
|---|---|
| Messages | One row per message: its name and when it is sent on the left ("After Q1 · Yes", and under it "Then Q2"), the copy in normal type on the right, and "88 characters · 1 segment" under it. `{first_name}` shows as a small "first name" chip. A message that costs a second segment for some leads says so in amber |
| Scoring | Plain rows - "Replied at all +10", then each question's options grouped under it - and a shaded Maximum row |
| Tiers | The queue's signal bars and each band |
| Settings | Expiry, clarifications before review, the segment limit |

Each card's one caveat is a quiet line at its foot, and the subtitle says the
values change through a migration and a pull request - apart from Seri's switch.
"Clarifications before review", not "Unclear replies before review": the setting
is 1, and it counts clarifications - the first unclear reply is clarified, the
second goes to review.

#### The automated call

The Calls tab shows the robot's call (`AUTO-CALL-SCRIPT.md`, "The script"): what it says, and the
settings it reads.

| Card | Shows |
|---|---|
| Call script | Every line the robot says, in the order a lead can hear them, in the Messages card's own rows: each question ("Q1 · Offer", and when it is asked - "When the lead picks up", "After Q1 · No"); each answer's reply and what follows ("After Q1 · Yes" - "Then puts them through to a person"), with what picks it under it - "Key 1, or: yes, yeah, yep, …"; each question's repeat line ("Unclear · Q1"); then the lines every question shares, as the call goes on - No response, Stop (key 9 and its words), the recording notice when calls are recorded, Hold, Next in line, Place in line, Busy - and the Voicemail. The header names the script; the foot names the voice |
| Calls | Automated calls On or Off; the hours and time zone ("11:00 AM - 5:00 PM", America/Phoenix); the days ("Monday to Friday"); the first call ("1 hour after the first text"); how many calls go out at once ("5 for each person free"); how long a "yes" rings people (25 seconds), and a lead on hold the person who came free (20); the hold line's safety stop (10 minutes); the confidence a spoken answer needs (0.4); and the call-back number the voicemail gives |
| Messages (Texts tab) | One more row, last: **Call · link**, the text a "yes" to the link sends - counted for length and segments like every other text |

**The robot's own readers, not the rows** - `db/call-script.ts`:
`loadActiveCallScript`, `readCallHours`, `readRingSeconds`,
`readOfferRingSeconds`, `readHoldMaxSeconds`, `readMinConfidence`,
`readCallsPerPerson`. A setting the robot cannot read shows what it uses instead -
`25:00` as a start shows 11:00 AM, as the robot calls at 11 - so the page never
shows a value no call will use.

**What only the api knows** comes from `api/admin/config.ts`: whether automated
calls are on (`AUTO_CALLS=on` and calling set up - an environment variable, so
the card says what turns it on rather than offering to), the calling number
(`TWILIO_PHONE_NUMBER`, which the voicemail reads out digit by digit - shown in
place of `{callback_number}`), whether calls are recorded, which is when the
recording notice is said, and whether `OPENAI_API_KEY` is set. `{place}` in the
hold line shows as "2, 3…".

No script active: the card says so, and the link text is not listed. The script
and its settings change by migration, like the texts - migrations 015 and 018 to
021 set them.

#### Seri's switch

The Calls tab's right column (`.config__side`) holds a **Seri** card above the
call settings: her state, On or Off, and a line on what follows - robot calls go to
her, use the script, get the script for want of the key, or none go at all with
automated calls off - worked out by `seriState` (pure, in
`pages/admin/ConfigPage.tsx`). **Switch on** / **Switch off** sit behind a confirm
step (`components/ConfirmDialog.tsx`); Switch on cannot be pressed without the key,
and after a switch the page reads the config again. The button posts to `POST /api/admin/config/ai-agent` with `{ "on": true }` or
`{ "on": false }` - anything else is 400 `invalid_body` - and does what
`npm run ai-agent -- on|off` does: on is refused without `OPENAI_API_KEY` (409
`no_key`), off always works, and each change is one activity-log row by whoever
clicked (`switchAiAgent`, `ai/settings.ts`). The next robot call follows it; no
restart. It changes nothing she says, only whether the robot's calls go to her
- `AI-AGENT.md` section 7, "Switches and rollout", owns the switch.

Nothing else of hers is here: her knowledge files are in the repo, not the
database, and the Calls tab's script is the one she falls back to. What she did
on each call is on the lead's timeline and in Admin > Leads' Call column
("Callback booked").

### Overview

`GET /api/admin/overview?period=today|7d|30d&tz=` - five totals, a per-agent
table, the system checks and a recent activity feed, all worked out from the
existing tables on each read. Nothing is stored as a running total: at 50-100
leads a day the queries are cheap, and a stale counter is worse than a slow one.

| Part | Shows |
|---|---|
| Totals | Leads in · Replied · Completed · Closed · Sold - for Today, 7 days or 30 days, chosen on the navy switcher |
| Agents | Per active user, superadmins included: **Working now**, **Closed** and **Sold** in the period, **Due today**, **Last active** |
| System | Database, EZ Texting sync, the expiry sweep, sending and calling - each OK or Degraded - and incoming replies, which shows its last reply with no verdict. Calling is Degraded when the phone number or the TwiML App no longer points at this server, and reads "not set up", with no verdict, where calling is off. From the health endpoint (`LOGGING.md`), so the screen and that endpoint cannot disagree |
| Recent activity | Under the cards: "nora closed Omar Haddad · Sold", newest first, the lead's name linking to its timeline; why it was closed after the name, when it was asked (`AGENT-WORKSPACE.md`, "Dispositions") |

**Every number counts what happened in the period:**

| Number | Counts |
|---|---|
| Leads in | Leads that arrived from EZ Texting in the period - by when they reached us (`ezt_added_at`, else `created_at`), the same expression as the queue's age |
| Replied | Leads whose **first** reply came in the period. A lead from yesterday who first replies today is today's; one writing again weeks later is not counted twice |
| Completed | Leads who finished their flow's questions in the period, whichever way it ended - a lead who said No and then chose special offers is one. `conversations.completed_at` |
| Closed | **Leads** closed in the period, not presses of Closed: a lead closed, reopened by a text and closed again is one. It counts `closed` and the retired `sold`, `not_interested` and `wrong_number` (`AGENT-WORKSPACE.md`, "Dispositions") |
| Sold | Of those, the **leads** closed as sold in the period: a Closed whose reason is Sold (`dispositions.reason`, asked since B04), or the retired `sold` from before 2026-09-28 (`SOLD_REASON`, `RETIRED_SOLD`). Not interested, Wrong number and a Closed saved without a reason are not. Leads, not presses, as Closed. Per agent in the agents table, against who saved it |
| Working now | Leads the agent holds right now, whatever the period |
| Due today | The agent's open callbacks due **by the end of today** in the viewer's time zone, overdue ones included - one booked for next week is not. A call back Seri booked counts once it is theirs - booked for the lead they held, or taken on a pick-up; one nobody has taken is no one's (`CALLBACKS.md`) |
| Last active | Their newest note, callback booked for them, outcome, call they placed or answered - a transfer they took from an automated call included, never one nobody took - or SMS that went out |

`period` defaults to `today`, which starts at the viewer's midnight: the browser
sends its time zone as `?tz=` (`startOfTodaySql`, `db/sql.ts`); an invalid zone is
400 `invalid_tz`, none means UTC, and an unknown period is 400
`invalid_period`. The response's `since` is that start - the viewer's midnight,
or 7 or 30 days ago - read with the counts. Leads are counted by when they reached
us, closings by when they happened, so a lead closed today about last week's lead
lands in today's figures.

**Last active and the feed are what the agent did**, not what was done to them. A
callback in either is under the name of the agent it is for - who booked it is
only in the activity log (`AUDIT.md`). A callback the system books for a missed
call (`reason = 'missed_call'`) and a call back Seri booked (`ai_booked`) are not
an agent's action, so neither is in the feed or moves Last active - both read only
`reason = 'booked'` - and nor does a call that only rang an agent.

**The activity feed** is a four-way union over `dispositions`, `notes`,
agent-booked `callbacks` and agents' own `messages` that went out, newest first,
capped at 50. Agent actions only: the automated flow is visible per lead on the
timeline, and this feed answers "what are my agents doing". The per-agent table
and the feed are the only view of agents' work across leads; one lead's own
history - every agent's notes, outcomes and texts, with who wrote them - is on its
timeline, open to every signed-in user. Agents cannot reach this page
(`AUTH.md`).

**A failing check is shown in the System card, not across the page.** The card's
header turns amber ("Needs attention") and the failing row says why in one amber
line under its name - "The last text was refused by EZ Texting."

**On screen** (`pages/admin/OverviewPage.tsx`) the page is in the card style of
every other admin page: the navy period switcher - Today, 7 days, 30 days - and
"Live · updated just now" at the top right; the five totals in one card, one row,
split by thin rules (`.stats`, as many columns as totals); the Agents table and the System checks side by side from
1100px wide; Recent activity across the page below, the lead names in the brand
navy. A period switch keeps the old numbers on screen, faded, until the new ones
land (`usePolling`'s `keepPreviousData` - `FRONTEND.md`, "The polling hook"),
rather than blanking for a spinner. The page polls the overview and the health
check separately, so a slow one cannot hold up the other. A failed refresh shows
"… Showing the last update." over the last numbers, and if the health check cannot
be read at all the System card says "Could not read the system checks" rather than
spinning.

The live system status - last poll, last inbound reply, worker health - comes from
the health endpoint rather than this route. That endpoint is superadmin-only, so
nothing outside can poll it (`LOGGING.md`).

### DNC list

`GET /api/admin/dnc?q=&page=&state=` - every number ever blocked, released or
not: the phone, the reason, when it was added, the lead if we hold one, and
whether and why it was released. There is no "who added it": `dnc_list` has no
such column, and the agent behind a DNC outcome is in the activity log
(`AUDIT.md`).

- `state` is `all` by default, or `blocked` or `released` (400 `invalid_state`
  otherwise). Counts for all three come back whichever is asked for, so a tab
  badge is right while another tab is open.
- `page` is a whole number from 1 to 100,000 (`parsePage`, `api/filters.ts`), 50
  rows a page.
- **Search** takes digits only when the query holds any, so `(555) 999-9999`
  finds `+15559999999`; a query with no digits matches the lead's name instead.
  `%` and `_` are escaped (`likeLiteral`, `db/sql.ts`), or a search box holding
  one would match every row.
- **The lead join is `LEFT`:** a number can be blocked before we ever hold a lead
  for it - the poller's check on a later partner delivery depends on exactly
  that - and those rows come back with `lead: null`.

A number reaches the list only through the block paths in `AGENT-WORKSPACE.md`,
"Blocking a number"; there is no manual add. It leaves only by the lead texting
START, which keeps the row and stamps `released_at` (`STATE-MACHINE.md`, "Opting
back in"). The screen shows released rows as released rather than hiding them, or
the list stops matching who is actually blocked.

**The page matches Admin > Leads:** one card - the queue's navy switcher for All /
Blocked / Released beside the search, then the table: the lead's name with the
number under it; the reason in words - Texted STOP, Opted out on EZ Texting, Agent
set DNC, Said stop on automated call; when it was added; and the state as an icon
and words - **Blocked** in red with a barred circle, **Released** muted with a tick
and "Texted START · date" under it. A number with no lead reads "No lead". A row
with a lead opens its timeline. Where numbers come from is a quiet note at the foot
of the card. The state tab, search and page are kept in the address (`?state=`,
`?q=`, `?page=`; `frontend/src/lib/dnc-view.ts`), as Admin > Leads does, so Back
from a lead's timeline returns to the same list.

## Rules

1. **Admin changes nothing but agents' accounts and Seri's switch.** Scoring
   rules, tier bands, message copy, expiry, the call script and its settings, and
   the DNC list are shown, not edited. They change through a numbered migration
   and a PR, which Jeel makes. Why: scoring and copy are not small changes - a
   mistyped point value silently reshuffles the queue, and a broken opener costs a
   second segment on every message or drops the STOP wording; a migration means a
   PR, a review and a git history of who changed what. Configuration's subtitle
   says so ("Read-only - changes go through a pull request - apart from Seri's
   switch, on Calls") and the DNC list's foot note ("Nothing is added or removed
   here"), so a superadmin is not left hunting for a Save button.
2. **A rule change leaves leads already scored on their old values.** There is no
   Save and no Recalculate, and nothing rescores on its own; a one-off rescore
   script can be run deliberately if it ever matters.
3. **Every admin route is superadmin only.**
4. **The screens show live values, read as the system reads them** - the robot's
   own readers, `expiryDays`, `pollIntervalSeconds` - never a copy, and never a
   value nothing will use.
5. **The DNC list has no add and no delete.** A number leaves it only by START,
   which keeps the row; the design brief calls it a compliance record.
6. **Overview counts what happened in the period, on each read.** Nothing is
   stored as a running total.

## Data

Configuration reads `flows`, `flow_questions`, `flow_choices`, `settings`,
`tiers`, the longest `leads.first_name`, and `call_scripts`, `call_steps` and
`call_choices`; its one write is Seri's switch, `settings.ai_agent`, through
`switchAiAgent`. Overview reads `leads`, `conversations`, `messages`,
`dispositions`, `notes`, `callbacks`, `calls` and `users`. The DNC list reads
`dnc_list` and `leads`. `SCHEMA.md` has the tables.

## Code

| File | What it does |
|---|---|
| `backend/src/api/admin/config.ts` | `GET /api/admin/config`, with what only the api knows; `POST /api/admin/config/ai-agent` |
| `backend/src/db/admin-config.ts` | `getAdminConfig`: the messages and their counts, scoring, tiers, settings, `callLines`, `callSettings`, Seri's switch |
| `backend/src/db/call-script.ts` | The robot's readers the page shows its settings through |
| `backend/src/ai/settings.ts` | `switchAiAgent`, `switchRefusal`, `readAiAgentSwitch` - shared with the command |
| `backend/src/api/admin/overview.ts` | `GET /api/admin/overview`: `parsePeriod`, `?tz=` |
| `backend/src/db/admin-overview.ts` | `getOverview`: totals, per-agent rows, the activity feed |
| `backend/src/api/admin/dnc.ts` | `GET /api/admin/dnc`: `parseState`, the page and search |
| `backend/src/db/admin-dnc.ts` | `listDnc` |
| `frontend/src/pages/admin/ConfigPage.tsx` | Configuration, its three tabs and the Seri card |
| `frontend/src/pages/admin/OverviewPage.tsx` | Overview |
| `frontend/src/pages/admin/DncPage.tsx`, `frontend/src/lib/dnc-view.ts` | The DNC list, and its view in the address |
| `frontend/src/lib/call-settings.ts` | The call settings in words - hours, days, waits |

## Tests

| What | Where |
|---|---|
| Each route turns away the signed-out and agents and lets a superadmin in; the three base paths answer 404 to `POST`, `PUT`, `PATCH` and `DELETE`; Seri's switch, its own route: on, off without the key, refused without it, a body that is not on or off; Overview's periods. Pinned, so read-only stays a decision rather than something that erodes | `api/__tests__/admin-screens.test.ts` |
| All three read models against a real database: the config against the antibiotics flow seeded by `012_flows.sql` (tiers and expiry from `001_init.sql`) and against an edited choice; the overview's period windows, totals, per-agent aggregates and activity feed, an outcome's entry carrying its reason - none on a Closed without one, nor on the retired `sold`; sold - a reason of Sold and the retired `sold` counted, sold twice once, Not interested, Wrong number and no reason not, only inside the period in the viewer's zone, per agent; the DNC list's states, search escaping - a name with an underscore, which the old code failed - and lead-less rows; the call script and its settings - every line in order and word for word against the script the robot uses (`core/call-script-fixtures.ts`, itself held to the database by `call-script-live-check`), each question's and answer's name and when, keys and words, the link text under Messages, the settings off and on, the recording notice only on recorded calls, a setting changed by migration, one the robot cannot read, and no script active | `scripts/admin-live-check.ts` |
| The Seri card: each state's words, the confirm then the switch, Cancel, no Switch on without the key | `pages/admin/ConfigSeri.test.tsx` |
| Overview's totals in order, Sold after Closed; the agents' Sold column, "-" for none; the feed's words, " · Sold" after the name | `pages/admin/OverviewPage.test.ts`, `pages/admin/OverviewPage.render.test.tsx` |
| The robot's call settings in words - hours, days, waits - their placeholders, what picks a line of the call script; the tab read from the address | `lib/call-settings.test.ts`, `pages/admin/ConfigPage.test.ts` |
| The DNC list's view in the address: its state tab, search and page | `lib/dnc-view.test.ts` |

## Not done

- **Export CSV** is in the design brief and not built: it hands a file of phone
  numbers to a browser, which needs Jeel to say so first.
- **No call figures on Overview** - calls made, reached, average length. None is
  computed; every call is on its lead's timeline. They can be added if the client
  asks.
- **The deep health endpoint needs a session**, so an uptime service cannot poll
  it (`LOGGING.md`).
- **Editing from the screen** is not built, by decision (rule 1) - nor the brief's
  Settings page (6f) or its phone-frame preview of the copy (`FRONTEND.md`,
  "Differences from the brief").

## Decisions

| Decision | By | Date |
|---|---|---|
| Admin is read-only except Agents: scoring rules, tier bands, message copy, expiry and the DNC list are shown, not edited, and change through a numbered migration and a PR. Recalculate is dropped | Jeel | 2026-09-23 |
| No manual add to the DNC list: a number reaches it only through a block path | Jeel | 2026-09-23 |
| One exception: Seri's switch on Configuration's Calls tab - Switch on / off, superadmin only, confirmed, recorded by whoever clicked. A button stops her faster than a command on the server; `npm run ai-agent` still works | Jeel | 2026-11-24 |
| Configuration redesigned as four cards in the other admin pages' style - "too messy" | Jeel | 2026-09-28 |
| Configuration split into three tabs, Texts, Scoring and Calls: with the call script added the page was too long to read | Jeel | 2026-10-25 |
| Overview rebuilt smaller, only what a superadmin acts on - "we are making the system complex" | Jeel | 2026-09-28 |
| Every Overview number counts what happened in the period - "i want all real" | Jeel | 2026-09-28 |
| Due today counts callbacks due by the end of today, overdue included | Jeel | 2026-09-29 |
| A failing check is shown in the System card, not in a box across the page | Jeel | 2026-09-28 |
| The DNC list's page matches Admin > Leads | Jeel | 2026-09-28 |

## History

- 2026-11-28 · Configuration reads the one bucket's active flow (`onlyBucket`); a bucket picker in its place is B31 · B08
- 2026-11-28 · Tests: the admin live check proves the feed's SQL carries an outcome's reason, where only a frontend test with a hand-built entry did · review of B01-B06
- 2026-11-28 · Overview counts sold: a Sold total after Closed, and a Sold column per agent - closed with the reason Sold, or the retired `sold`. Closed and sold are counted in one pass over the period's outcomes; counted in two more, Overview at 50,000 leads went from 25 ms to 29 ms, and in one pass it is 24 ms · B05
- 2026-11-28 · The activity feed says why a lead was closed: "nora closed Omar Haddad · Sold" · B04
- 2026-11-27 · Rewritten to the area standard: dated notes to this History, decisions to a table, one part of How it works per screen. Fixed: "every route has no POST, PUT, PATCH or DELETE - tests assert that" - `POST /api/admin/config/ai-agent` exists, and `admin-screens.test.ts` checks only the three base paths; "Phase 4 can add call figures back" - Phase 4 was done 2026-10-01. The read-only decision and its reasons moved here from CLAUDE.md §10; the DNC block paths linked to `AGENT-WORKSPACE.md`; merged in: Overview on screen and the Seri card from `FRONTEND.md` · docs standard · D19, D27
- 2026-11-24 · Seri's switch on the Calls tab, the one control on Configuration; `ConfirmDialog` moved out of the Agents page into `components/` for it; proved by `ConfigSeri.test.tsx`, not yet seen in a browser that day. Until then Seri was not on Admin, and the command was the only way · Jeel
- 2026-11-23 · Overview's `since` is the period's start, read with the counts; it had held the time of the request, which nothing on screen read. Written down: a callback in Last active is whose it is, who booked it only in the log; one lead's history is on its timeline, open to everyone, and this page is the one that puts every agent's work side by side · review R14
- 2026-11-23 · The DNC list keeps its state tab, search and page in the address, so Back from a lead's timeline returns to it · review Q8
- 2026-11-22 · Overview's System card spun for ever when the health check failed; it is a banner since, with "Showing the last update" when there is one · review M31
- 2026-11-22 · Configuration's reads run one at a time: eleven together, with the automated call's settings, took more than the pool's ten connections on a page polled every 5 seconds. With 50,000 leads the page reads in 8 ms (`npm run speed`) · review M18
- 2026-11-22 · Expiry read through `expiryDays`, as every other reader takes it; the page had parsed it on its own and could show 0 while the system used 7 · review M17
- 2026-11-22 · The DNC list's `page` capped at 100,000 through `parsePage`; it had no upper bound, and `?page=1e20` was a 500 · review M17
- 2026-11-22 · Overview's "due today" ends at the viewer's real midnight on the two days a year the clocks change too (`startOfTomorrowSql`) · review M11
- 2026-11-12 · A call back Seri booked is not an agent's action: Overview's feed and Last active read only `reason = 'booked'`; once an agent has taken one it counts in their Due today · A15, A16
- 2026-11-02 · The Calls card shows how many calls go out at once, "5 for each person free" - migration 021 · T29
- 2026-10-25 · The automated call on Configuration: the Call script and Calls cards, and the link text last under Messages - eighteen messages for the antibiotics flow, seventeen before; the page split into Texts, Scoring and Calls the same day · T24
- 2026-10-06 · "Answered all 3" renamed Completed, since a flow stopped being three questions
- 2026-10-05 · The messages listed as a lead receives them, from the flow: until then, nine fixed messages - three questions, three clarifications, the review text, the thanks and the missed-call text. The scoring card from each flow's choices · Phase 5, flows
- 2026-10-02 · Overview's calling check reads Degraded when the number or the TwiML App no longer points at this server · Phase 4
- 2026-10-01 · A callback the system books for a missed call, and a call that only rang an agent, are not an agent's action: not in the feed, not Last active · Phase 4
- 2026-09-29 · `longestNameIsFallback`, so the page says when the worst case is the `there` fallback rather than a name
- 2026-09-29 · Due today counts callbacks due by the end of today, overdue included; it counted only those already due, so a 3 PM callback showed nothing all morning, and the column was called Callbacks due · Jeel
- 2026-09-28 · Overview rebuilt smaller. Removed: the funnel, which drew the same numbers as the cards as bars; the HOT, Callbacks set and DNC added cards; every call figure - Calls made, Reached, average call length - with `callsBuilt`, which only said they were zero; and the per-agent outcome breakdown ("Callback set 1 Closed 2 No answer 3"), since outcomes are Closed and DNC and Closed has its own column. None of it is computed any more. The page was rebuilt in the card style the same day; it had shown the call figures dimmed, with a note, while calling was not built, and the old `.kpi`, `.funnel`, `.overview__*`, `.config__title` and `.config__choice` rules went with it (`FRONTEND-STYLE.md`, History) · Jeel
- 2026-09-28 · Overview's numbers count what happened in the period. Until then Replied and Completed counted leads that *arrived* in the period, Closed counted presses, and Callbacks due counted every open callback; the percentages under Replied and Completed went with the first fix, since a share of "leads that arrived" no longer applied · Jeel
- 2026-09-28 · A failing check shown in the System card; the red box above the page repeated the card, louder, and looked generated · Jeel
- 2026-09-28 · "Today" is the viewer's day: the browser sends `?tz=`; it had been the database's UTC midnight
- 2026-09-28 · Switching Overview's period fades the numbers instead of blanking; checked by sampling the page every 20 ms through a switch - it never went blank
- 2026-09-28 · Configuration redesigned as four cards. Gone: the blue "changed through a migration" box (one clause of the subtitle now), the copy in a code font on grey, the upper-case row labels, the coloured tier pills, and three paragraphs of notes · Jeel
- 2026-09-28 · The DNC page redesigned to match Admin > Leads; the blue box explaining where numbers come from became the note at the card's foot. Search escaping fixed: the DNC query's own copy of the `LIKE` escape was a template literal that produced the text `${c}`, so a `%` or `_` was never escaped, and its digit clean-up read `'D'` for `'\D'`, stripping the letter D instead of every non-digit; its check proved only that `%` matched nothing, which the broken version also did. Every search uses the one escape in `db/sql.ts` since · Jeel
- 2026-09-26 · The three endpoints and their read models built - Phase 3 tasks 10, 11 and 12; the screens are tasks 23, 24 and 25
- 2026-09-23 · Admin made read-only except Agents. The original Week 3 item 7 and `DESIGN-PROMPT.md` 6b, 6c, 6e and 6f had the superadmin editing them from the screen: scoring rules and tiers (6b) editable inline with Recalculate existing - built as a read-only card, Recalculate dropped; message copy (6c), seven editable fields - read-only, on Configuration's Texts tab, the score table on Scoring; settings (6f) - expiry, delivery type, poll interval, caller ID - not built as an editor: expiry and the other flow settings shown read-only on Texts, the poll interval a settings row, caller ID an environment variable; the DNC list (6e), a table plus Add manually - read-only; Agents (6d) unchanged · Jeel
