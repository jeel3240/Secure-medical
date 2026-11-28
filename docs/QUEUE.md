# Priority queue

`GET /api/leads` - the list agents work down, best lead first: who is in it, the
order, and the one status each row shows. Any signed-in user; a superadmin sees
the same list. The route is `backend/src/api/leads.ts`, the query
`backend/src/db/queue.ts`, the status `backend/src/core/queue-tags.ts`, and the
rules it shares with Admin > Leads `backend/src/db/lead-state.ts`; the screen is
`frontend/src/pages/QueuePage.tsx` (brief: `DESIGN-PROMPT.md` section 2).

## How it works

Every open queue screen asks for the list every 5 seconds (`FRONTEND.md`, "The
polling hook"). Each request is one statement (`listQueue`): it works out which
leads need a person, orders them, takes the page, and counts the tiers and
sources from the same set. Nothing is stored - who is in the queue, where, and
with what status are worked out from the tables every time.

### Who is in it

Only leads that need a person. Agents contact people who have given them a
reason to: a lead still answering the questions has not asked for a call, and
a call would interrupt them. `INCLUDED` in `db/queue.ts` is the rule.

**Never, whatever else is true:** a phone with a live `dnc_list` row. An opt-out
is absolute. A row released by START (`released_at` set) does not count -
`STATE-MACHINE.md`, "Opting back in".

**Five reasons stand on their own** - no score needed, and they keep even a
closed lead in:

| Reason | Why a person is needed | Rule |
|---|---|---|
| An active agent holds it | Being worked. A lead never vanishes from under the agent working it, whatever its conversation says. One picked up before it answered anything leaves again once let go, until it replies | the holder, joined through `users.is_active` |
| An unread text | Texted something the questions cannot handle - after the conversation ended, to an agent who took it over, or after a phone call took it over. `STATE-MACHINE.md`, "Which replies need a person", rules 2b and 2d | `has_unread_inbound` |
| An unreturned missed call | Rang our number and nobody answered. A lead who has never texted is in the queue for it. `INCOMING-CALLS.md`, "A missed call" | `MISSED_CALL_SQL` |
| An unreturned missed "yes" | Said yes on the automated call, nobody took the transfer, and heard "An agent will call you back shortly" (`script_result = 'transfer_missed'`) | `MISSED_YES_SQL` |
| A promised call back, due | A call back Seri booked whose time has come, or any open call back whose agent has been deactivated - `CALLBACKS.md`, "A call back nobody has". Before its time it puts nothing in | `PROMISED_CALLBACK_DUE_SQL` |

The robot calls only leads who never replied, so a missed "yes" and most of
Seri's call backs have no score. A missed call and a missed "yes" stay until
somebody gets back to the lead - an agent's call, a call a person was on, an
agent's text that EZ Texting took, or an outcome saved (`nobodyGotBackSince`,
`db/lead-state.ts`). A promised call back stays until it is done: marked done,
or finished by an outcome. Since an outcome clears a missed "yes", that one
never meets a closed lead.

**Three more need a score above 0 and a lead that is not closed.** Scoring
starts at the first reply, so a score is the mark of a responder:

| Reason | Why a person is needed |
|---|---|
| Newest conversation `completed` | Finished the flow's questions, or asked to hear from a rep - except one that ended `offers` (asked only for special offers: a list for the client's campaigns, not a call) or `declined` (said no to the offers and to a rep). `NOT_FOR_AGENTS`; `FLOWS.md`, "What a choice's ending means" |
| Newest conversation `review` | Replied, and we could not understand it |
| A callback booked and not done | An agent promised a call. This is also what keeps an expired lead with a callback in reach |

"Closed" is defined once, `CLOSED_SQL`, and Admin > Leads uses the same
definition - `ADMIN-LEADS.md`, "Closed", has what closes a lead and what
reopens it. So a closed lead is in the queue only for one of the five reasons
that stand on their own, or because a callback booked after closing reopened it.

A lead partway through the questions is on Admin > Leads, under Answering, and
nowhere an agent works from - unless an agent holds it, a callback is booked, it
has an unread text, or it rang us and nobody answered. Someone who stops for
good expires after the reply window and never reaches the queue (Decisions).

Only the newest conversation counts. Older ones are history, so a lead who
completed a second conversation is not dragged back by the first having expired.

### The order

1. **A promised call** - a missed "yes" or a due promised call back - sorted
   together on when the call was promised for, the earliest first:
   `promised_at`, the `LEAST` of `MISSED_YES_AT_SQL` (when the robot's call was
   made) and `PROMISED_CALLBACK_DUE_AT_SQL` (the time the call back was booked
   for). An overdue one stays on top until someone calls.
2. The tier: HOT, then WARM, then LOW - `tiers.sort_order`, as `tier_rank`.
   A lead with no tier comes after LOW.
3. The most recently received (`RECEIVED_SQL`: `ezt_added_at`, else `created_at`).
4. Id, the higher first, so two identical rows never swap places.

The tier says how strong the lead is; inside a tier, speed to contact is what
matters. So a HOT 85 that arrived two minutes ago comes before a HOT 90 that has
waited five days, and every HOT lead comes before every WARM one, however new.
The score is still on every row and on the lead's page; it no longer orders the
rows. The rank is the table's `sort_order`, never the tier's text, which would
put LOW before WARM.

A promised call comes before all of it: the lead was told a person would call -
shortly, or at the time they picked - and nothing in the queue is warmer. With
no tier it would otherwise sink to the bottom. The longest waiting goes first,
as the hold line takes the longest waiting first (`AUTO-CALL-TRANSFER.md`, "The
hold line"). Once someone gets back to the lead it drops to its own place -
usually out of the queue, as it never replied.

An agent's own callback is not moved up: it is theirs, on My Callbacks, and
keeps the lead in its tier's place.

A lead with no tier and no promised call - held before it answered, or one who
rang us and was missed - sorts to the bottom, newest first. The list stops at
100 rows by default, so in a queue that long it would not be shown; at 50-100
leads a day the queue has not come close.

**One order, written once.** The page's rows are picked in the `page` lateral
and ordered again by the outer statement; both use `queueOrder`, so the two
cannot drift apart. The rank is looked up for each queued lead
(`SELECT sort_order FROM tiers WHERE name = c.tier`), not joined in `BASE`: the
join changed Postgres's plan for the whole statement and took the queue as it
opens from 84 ms to 293 ms at 50,000 leads.

**The page says the order** (`orderText`, `QueuePage.tsx`): "Missed transfers
and Seri's due call backs first, then Hot, Warm and Low, newest first." while
automated calls are on, and "Hot, Warm and Low, newest first." while they are
off, when no transfers are made. A missed "yes" nobody got back to before
automated calls were switched off still sorts first, under the second line.
"Missed a transfer" is already what the app bar says to the person who let one
ring out (`AUTO-CALL-TRANSFER.md`, "Letting a transfer ring out turns it off").

**Only under All.** A missed "yes" and a due call back of Seri's have no tier,
so picking Hot, Warm or Low hides them, like any lead with no score. The tier
switcher starts on All.

### The tag

At most one status per row - the STATUS column - worked out, never stored. The
API returns what is true and the screen words it (`components/QueueStatus.tsx`):
`{ kind: 'working', agentId: 7, agentName: 'Michael' }` becomes "Working –
Michael".

A tag answers the two questions an agent scanning the queue has: is somebody
already on this, and why is it here? Most rows have none. When several apply,
the first wins:

| # | `kind` | Shown when | Carries |
|---|---|---|---|
| 1 | `working` | An **active** agent holds the lead. "Working – Michael" | `agentId`, `agentName` |
| 2 | `missed_call` | The lead rang us, nobody answered, and nobody has got back to them since - `MISSED_CALL_SQL`. "Missed call", bold | |
| 3 | `wants_call` | A missed "yes": the lead said yes on the automated call, nobody took it, and nobody has got back to them since - `MISSED_YES_SQL`. "Wants a call". These rows are first in the queue | |
| 4 | `callback`, `due` | A promised call back whose time has come - the earliest. "Callback · 3:00 PM" while it is nobody's, "Callback – Maya Chen · 3:00 PM" once taken; bold: we owe it | `at`, `due`, and `agentId`, `agentName` once taken |
| 5 | `inbound_reply` | The lead has texted and nobody has read it. "Inbound reply", bold | |
| 6 | `callback` | A callback is booked and not done - the soonest. "Callback – Maya Chen · 8:13 PM", with the date when not today; "Callback · 8:13 PM" for one nobody has. Does not lock the row | `agentId`, `agentName` (absent while nobody's), `at` |
| 7 | `wants_call` | The lead said No to the first question, then asked to hear from a rep - the flow ended `wants_contact`. Says why a lead with 10 points is in the queue | |
| 8 | `needs_review` | Conversation `review`: replies we could not read | |
| - | `null` | None of those: the lead is waiting to be picked up. The screen shows a hyphen | |

A held lead reads Working whatever else applies. The queue says Working only
while someone holds the lead; Admin > Leads keeps saying Working after it is
released (`ADMIN-LEADS.md`, "Working").

**One status for two reasons.** A missed "yes" reads **Wants a call**, the
words of row 7: both leads asked to talk to a person. It ranks with the missed
call, though, not with row 7 - the lead was promised a call back a few minutes
ago and wants to talk now, which outranks a text waiting to be read. The lead's
card keeps saying it once the lead is picked up and the queue says Working: the
`flags.missedYes` badge (`AGENT-WORKSPACE.md`, "The lead card").

**A callback names whose it is**, which answers the first of the two questions.
It ranks below an unread reply, which needs reading whoever's call it is. A
booked callback keeps a lead in the queue (above), unless the lead is closed,
and shows as Callback – name · time unless a higher tag applies. A call back
nobody has - one Seri booked that no agent has taken, or a deactivated agent's -
names nobody; the first agent to pick the lead up takes it (`CALLBACKS.md`, "A
call back nobody has"), and the tag names them from then.

Call history and callback times belong to the agent working the lead - their
callbacks are on My Callbacks, every call is on the lead's timeline - so the
queue does not repeat them.

### Filters

`GET /api/leads?tier=&source=&since=&q=&limit=`

| Parameter | Takes | Refused with |
|---|---|---|
| `tier` | `HOT`, `WARM`, `LOW`, comma-separated or given more than once, any case | 400 `invalid_tier` |
| `source` | How EZ Texting received the contact (`API` for every production lead - `ADMIN-LEADS.md`, "Not done"), comma-separated or given more than once, each matched exactly | 400 `invalid_list` only for a value that is not text |
| `since` | `1h`, `24h`, `7d`, `30d`, or `all` | 400 `invalid_since` |
| `q` | Name, or phone in any punctuation | 400 `invalid_q` when given twice |
| `limit` | Whole number above 0; clamped to 500, default 100 | 400 `invalid_limit` |

A bad filter is refused rather than quietly ignored, so a typo in a link shows up
as an error instead of the wrong queue. A list given twice - `?source=A&source=B`
- is both (`parseList`), and a search given twice is refused (`parseSearch`),
both in `api/filters.ts`, which Admin > Leads and the DNC list read theirs
through too.

`q` matches first and last name, or the phone with punctuation stripped, so
`(602) 555-0147` finds `+16025550147`. What is typed is escaped before it reaches
`LIKE` (`leadSearchSql`, `db/sql.ts`): a `%` in the search box is the
character, not a wildcard.

### The response

```jsonc
{
  "leads": [ { "id": 7, "phone": "+1…", "firstName": "…", "lastName": "…",
               "source": "CORE-G-27", "receivedAt": "…", "score": 90,
               "tier": "HOT",
               "answers": [ { "key": "q1", "heading": "Requested info", "label": "Yes" },
                            { "key": "q2", "heading": "Used telemedicine", "label": "No" },
                            { "key": "q3", "heading": "Next step", "label": "Talk to an agent" } ],
               "conversationStatus": "completed", "tag": null } ],
  "counts":  { "all": 12, "HOT": 4, "WARM": 5, "LOW": 3 },
  "sources": ["CORE-G-27", "CORE-G-31"],
  "total":   12,
  "limit":   100
}
```

`counts` feeds the tier switcher (All, Hot, Warm, Low with their counts), which
is also the tier filter, so it is counted **without** the tier filter -
otherwise picking HOT would zero the other two and the agent would lose sight
of what is waiting. `sources` is the dropdown and is counted without the source
filter, for the same reason: picking one source would otherwise leave it alone
in the list with no way back. Every other filter applies to both.

`total` is how many matched everything asked for, so the screen can say when the
limit cut the list short. It costs no extra query: the tier counts already carry
every other filter, so the selected tiers add up to it.

`receivedAt` is when the lead reached us, which is what the ticking Waiting
column counts from.

`answers` is what the lead answered, in their flow's order: one entry per
question answered, with the question's `heading` and the choice's `label` as
they were saved with the answer (`conversation_answers`, `FLOWS.md`) - so a
choice renamed later does not rename what an earlier lead picked. The screen
shows them in one **Answers** column, "Yes · No · Talk to an agent", with the
headings on hover.

`conversationStatus` can be `suppressed`: a lead who sent STOP, then START, and
has written again.

### How fast it is

Whether a lead belongs in the queue is worked out from several tables on every
request, so the cost grows with every lead ever received, not with the size of
the queue. `npm run speed` (`backend/scripts/speed-check.ts`) loads 50,000 fake
leads - about a year and a half at 100 a day, with their answers, messages,
calls, robot calls, call backs, notes and outcomes - and times every screen's
read. On a laptop the queue as it opens takes about 82 ms, one tier about the
same, the last 7 days about 13 ms and a name search about 10 ms. History has
each measurement.

What keeps it there:

- **One statement.** The queue is built once (`q`, `MATERIALIZED`); the tier and
  source counts (`grouped`) and the page are both read from it, and only the
  page's rows look up their answers, next callback and missed call.
- **Indexes by lead** - `callbacks (lead_id)`, and agents' own texts in
  `messages` (migration 013).
- **`jit=off`** on the app's connections (`db/pool.ts`): Postgres priced these
  statements far above their cost and spent longer compiling them than running
  them.
- **One "nobody got back to them" rule, written against the call's lead**
  (`nobodyGotBackSince`, `db/lead-state.ts`), so Postgres works out every
  missed call and missed "yes" once per statement and looks each lead up in that
  set, rather than asking once per lead.

Each refresh still looks at every lead once. If that ever matters - past a few
hundred thousand leads - the fix is to store "needs a person" on the lead and
maintain it: a design change, not a tuning one.

### The screen

`frontend/src/pages/QueuePage.tsx`. One card holds the filters and the table, the
table's head a light grey band:

- **Under the title**, the line that says the order (`orderText`); beside it, "Live ·
  updated just now" (`LiveStatus`).
- **The filters:** the tier switcher - All, Hot, Warm, Low, each with its count - one
  choice at a time (the API takes several, should a screen ever want them); a search
  box for name or phone; a Source select, one source at a time; a time window - Last
  hour, Last 24 hours, Last 7 days, All time.
- **Columns:** Tier, Lead (the phone under the name), Answers, Score (right-aligned),
  Waiting (right-aligned), Source, Status, and the action. An empty cell is a hyphen.
- **Tier** is signal bars and the word (`TierSignal`).
- **Answers** is one cell, "Yes · No · Talk to an agent", each question's heading on
  hover (`answersTitle`) and written out for a screen reader.
- **Waiting** is the time since the lead arrived, in monospace, ticking once a second
  on its own clock (`lib/useSecond.ts`, worded by `formatAge` in `lib/format.ts`), not
  on the poll: a number that moved only when the data refreshed would be wrong for up
  to five seconds at a time. Every value has the same weight and colour - no
  thresholds - and a locked row is grey all the way across.
- **Status** is an icon and the words (`components/QueueStatus.tsx`; the icons in
  `FRONTEND-STYLE.md`, "Status icons"), bold as "The tag" says.
- **The action**, centred: Pick up, Resume, View, or a padlock and *Locked*
  (`FRONTEND.md`, "What the button offers"); it fills with the header's navy on hover.
  A row click opens the lead's workspace read-only; the lead's name is a link to the
  same place, so a row opens from the keyboard - except on a locked row.
- **A switch of tier or search** keeps the old rows on screen, faded and unclickable,
  until the new ones land (`FRONTEND.md`, "The polling hook").
- **Past the limit**, a note under the table: "Showing the top 100 of 140. Narrow the
  filters to see the rest." (`queue__truncated`).

## Rules

1. **Nothing about the queue is stored.** Who is in it, the order and the tag
   are worked out on every request.
2. **A blocked number is never in the queue** - a live `dnc_list` row, whatever
   else is true.
3. **A lead an active agent holds is always in it**, score or none.
4. **Only the newest conversation counts.**
5. **A claim by a deactivated agent counts as nobody's.** `assigned_to` is joined
   through `users.is_active`, so deactivating an agent hands their held leads back
   to the floor instead of parking them behind a name nobody can sign in as.
   The claim endpoint and the lead card agree (`AGENT-WORKSPACE.md`, rule 3).
   Nothing is rewritten: reactivating them gives the leads back.
6. **Closed is one definition**, `CLOSED_SQL`, shared with Admin > Leads, so the
   two screens cannot disagree.
7. **A promised call comes first**, before any tier; then the tiers, each newest
   first.
8. **At most one tag per row**, the first that applies in the table's order.
9. **A bad filter is refused with a 400**, never ignored.

## Data

Reads `leads`, the newest row of `conversations`, `conversation_answers`,
`dnc_list`, `users`, `callbacks`, `calls`, `messages` and `dispositions`; writes
nothing - `SCHEMA.md`. `assigned_to` is written by claim and release
(`AGENT-WORKSPACE.md`, "Claim and release"), and `has_unread_inbound` is
cleared by marking a lead read (`AGENT-WORKSPACE.md`, "Marking a lead read").

## Code

| File | What it does |
|---|---|
| `backend/src/api/leads.ts` | `GET /api/leads`: parses the filters, calls `listQueue`. Also claim and release |
| `backend/src/api/filters.ts` | `parseList`, `parseSearch`, `parseSince` - shared with Admin > Leads and the DNC list |
| `backend/src/db/queue.ts` | `INCLUDED`, the order (`queueOrder`), `listQueue` - the page, the counts and the sources in one statement |
| `backend/src/db/lead-state.ts` | `CLOSED_SQL`, `MISSED_CALL_SQL`, `MISSED_YES_SQL`, `MISSED_YES_AT_SQL`, `PROMISED_CALLBACK_DUE_SQL`, `PROMISED_CALLBACK_DUE_AT_SQL`, `nobodysCallbackSql`, `RECEIVED_SQL`, `newestConversation` |
| `backend/src/core/queue-tags.ts` | `queueTag`: which tag wins, pure |
| `frontend/src/pages/QueuePage.tsx` | The screen; `orderText`, the line that says the order |
| `frontend/src/components/QueueStatus.tsx` | A tag's icon and words, and which are bold |

## Tests

| What | Where |
|---|---|
| Which tag wins | `core/queue-tags.test.ts` |
| The route: filters, refusals, the response | `api/__tests__/queue.test.ts` |
| The SQL against a real database - inclusion, exclusion, order, every tag, each filter, the counts; a partway lead kept out, and kept in when held, booked, or taken over and replied to; call attempts showing no tag | `scripts/queue-live-check.ts` |
| The order: a HOT 85 from two minutes ago above a HOT 90 from five days ago; across the whole queue every HOT above every WARM and every WARM above every LOW, newest first inside each; a lead with no tier after LOW, though newest; a missed "yes" and a due call back still first; two identical rows the higher id first | `scripts/queue-live-check.ts`, "order: tier first, then newest (B01)" |
| A missed "yes", through the real writes (`startAutomatedCall`, `missTransfer`, `startCall`, `setDisposition`): first, before every HOT lead, the longest waiting on top; Wants a call with no score; flagged on the card; in the total under no tier; a robot call ending any other way puts nobody in; the link text, the automated text and an agent's refused text do not clear it; picked up it reads Working and stays first; an agent's call, text or outcome clears it | `scripts/queue-live-check.ts` |
| Seri's call backs, booked as `/auto/ai-after` books them (`keepCallResult`) and taken by `claimLead`: not due, not in; due, first, no score, tagged nobody's and due; overdue, beside a missed "yes" in promise order; picked up, the agent's, recorded once; put back, still on top and named; a second pick-up leaves it with the first; an outcome finishes it | `scripts/queue-live-check.ts` |
| A deactivated agent's call back | `scripts/queue-live-check.ts`, "a deactivated agent's call back (D2)" |
| The missed call: in with no score, reopening a closed lead, its tag, what settles it | `scripts/calls-live-check.ts` |
| A read lead leaves the queue; a completed one stays | `scripts/read-flag-live-check.ts` |
| The order line, and the Answers cell's tooltip - each question named on hover, nothing when nothing is answered | `pages/QueuePage.test.ts` |
| A tag's words and its own icon, no dot drawn; a callback's time - one of Seri's with no name yet, bold once due; the tier bars | `components/QueueStatus.test.tsx` |
| Speed with 50,000 leads | `npm run speed` - `backend/scripts/speed-check.ts` |

## Not done

- **The STATE column in the mockup is not built.** EZ Texting sends no state with a
  contact (`EZTEXTING-API.md`), so the API returns none and every row would read "-"
  for ever; the column is left out rather than given permanent space in a table meant
  to be dense, and goes back in if the partner ever sends state.
- **No paging.** `limit` cuts the list and `total` says by how much; at 50-100
  leads a day the default of 100 holds several days of queue.
- **"Seen before, stopped at Qn"** is in the mockup and not built: a returning
  lead is not yet handled (`STATE-MACHINE.md`, "A number that comes back").
- **Membership is worked out, not stored**, so the read grows with every lead
  ("How fast it is").

## Decisions

| Decision | By | Date |
|---|---|---|
| The queue holds only leads that need a person. A lead partway through the questions is not in it: it has not asked for a call, and a call would interrupt it | Jeel | 2026-09-28 |
| A lead who stops partway expires and never reaches the queue - accepted: they never said how, or whether, they wanted to be contacted | Jeel | 2026-09-28 |
| A closed lead leaves the queue; only what stands on its own, or a callback booked after closing, brings it back | Jeel | 2026-09-28 |
| An unread text puts a lead in the queue on its own, score or none | Jeel | 2026-09-28 |
| Holding a lead needs no score: a lead someone holds is always in the queue | Jeel | 2026-09-29 |
| Score first, then newest, then id - replaced by tier first, then newest (2026-11-27) | Jeel | 2026-09-22 |
| Few tags, and most rows have none; New and Attempted dropped | Jeel | 2026-09-28 |
| "Working", the word Admin > Leads uses, not "In progress" | Jeel | 2026-09-28 |
| The Callback tag back, naming whose callback it is | Jeel | 2026-09-29 |
| A "yes" nobody takes puts the lead first in the queue as Wants a call - the longest waiting on top, ranked with the missed call | Jeel | 2026-10-17 |
| A due call back Seri booked shares the top with a missed "yes", sorted on when each call was promised for | Jeel | 2026-11-11 |
| Tier first, then newest, after the promised calls: HOT newest first, then WARM, then LOW. Score first keeps a HOT 90 that has waited five days above a HOT 85 that arrived two minutes ago. The page's line changes with it. Made while planning Phase 8 but not bucket work. Built - B01 (`bucket-tickets/B01-queue-tier-then-newest.md`) | Jeel | 2026-11-27 |
| No STATE column on the screen: EZ Texting sends none; it returns if the partner ever sends state | Jeel | 2026-09-26 |
| The screen rebuilt to Jeel's mockup: one card, a segmented tier switcher one choice at a time, tiers as bars, statuses as an icon and words | Jeel | 2026-09-28 |
| Every waiting time looks the same: no amber, red or bold thresholds | Jeel | 2026-09-28 |
| Each status its own icon, not a dot | Jeel | 2026-09-28 |

## History

- 2026-11-28 · Tier first, then newest, after the promised calls: score left the order, `tier_rank` from `tiers.sort_order` took its place, the two ORDER BYs became one `queueOrder`, and the page's line reads "Hot, Warm and Low, newest first". Timed at 50,000 leads on the same laptop: the queue as it opens 83.6 ms before, 82.4 ms after; one tier 87.2 and 82.3; a name search 10.8 and 10.0; the last 7 days 14.5 and 13.0. A first version joined `tiers` in `BASE` and took the queue as it opens to 293 ms, as the join changed the plan for the whole statement; the rank is looked up for each queued lead instead · Jeel · B01
- 2026-11-27 · Rewritten to the area standard: dated notes to this History, decisions to a table; the polling hook and the on-screen lock handed to `FRONTEND.md`; a call back nobody has to `CALLBACKS.md`; the constant named `AI_CALLBACK_DUE_SQL`, which no longer exists, corrected to `PROMISED_CALLBACK_DUE_SQL`; merged in: the screen from `FRONTEND.md`, and the tier-first decision row from `BUCKETS.md` · docs standard · D17, D27, D45
- 2026-11-27 · Tier first, then newest decided, not built - raised while planning several buckets (`BUCKETS.md`), built on its own · Jeel · B01
- 2026-11-23 · A deactivated agent's open call backs are nobody's: no name on the tag, a due one at the top as "Callback · 2:00 PM" in bold (`PROMISED_CALLBACK_DUE_SQL`, which replaced `AI_CALLBACK_DUE_SQL`), the first agent to pick the lead up takes it. Before, an open call back stayed in the deactivated agent's name - "Callback · Maya" - so others left it, it was on nobody's My Callbacks and not on Overview: a promised call nobody would make unless a superadmin moved it by hand · review D2
- 2026-11-23 · The page's order line names Seri's due call backs; it said only "Missed transfers first" · review R15
- 2026-11-22 · A list given twice is both and a search given twice is refused; both were dropped without a word · review M19
- 2026-11-12 · A call back Seri booked, once due, puts the lead in the queue at the top beside a missed "yes", tagged Callback · time in bold; the first agent to pick the lead up takes it. Timed at 50,000 leads with her call backs in the speed check (one robot call in twenty, done except in the last two days), two rounds each: the queue as it opens 74 ms before, 76 ms after; one tier 74 and 77; a name search 16 and 16; the last 7 days 11 and 11 · A16
- 2026-10-24 · A missed "yes" first in the queue, tagged Wants a call, cleared as a missed call is. Timed with the robot's calls in the speed check's leads - one to every lead who never answered, the "yes" nobody took called back an hour later except in the last day: the queue as it opens 96 ms before, 75 ms after; one tier 96 and 79; the last 7 days 4 and 11; a name search 9 and 10; Admin > Leads one status 175 and 156; the lead card 1.0 and 1.4 ms. A first version asked "does this lead have such a call?" once per lead and took 122 ms; the missed call's rule tied its three "since" checks to the lead directly, which stopped Postgres working the calls out once per statement. Both now share `nobodyGotBackSince`, written against the call's lead, which made the missed call inside "Closed" faster too. The last 7 days lost a few milliseconds: the sets cover every call, however few leads the date leaves · T22
- 2026-10-06 · Timed against 50,000 leads (`npm run speed`, a laptop): the queue as it opens 7.8 s before, 0.18 s after; one tier 4.6 and 0.18 s; the last 7 days 0.87 and 0.01 s; a name search 0.07 and 0.02 s. With a few hundred leads both were instant, which is why nothing had shown it. Three causes, none from the flows change: "has a callback been booked since this lead was closed?" read the whole `callbacks` table once per closed lead (migration 013 indexed `callbacks (lead_id)`, and `messages (lead_id)` for agents' own texts); the page, the tier counts and the source list were three statements each working out the whole queue (now one, `listQueue`); and Postgres compiled the statements before running them, which took longer than the query (`jit=off`) · migration 013
- 2026-10-06 · Wants a call got its own icon, the handset - it had borrowed the chat bubble, which meant Answering on Admin > Leads · review
- 2026-10-06 · A lead who said no to the offers and to a rep (`declined`) left out, as one who asked only for offers is · flows
- 2026-10-05 · The Answers column: a row carried `q1`, `q2`, `q3` and the queue had three fixed columns, Interest, Timing and Preference; flows differ in how many questions they ask. A lead who asked only for special offers left out; the Wants a call tag for a lead who said No, then asked to hear from a rep · Phase 5, flows
- 2026-10-01 · An unreturned missed call a reason of its own, and the Missed call tag - on screen a handset with an arrow turned away, bold like Inbound reply · Phase 4
- 2026-10-01 · "Who is in it" rewritten to say what `INCLUDED` says; the two tables it replaced ("always" and "one of") had drifted from it · doc review
- 2026-09-29 · The Callback tag came back the day after it was dropped, naming whose callback it is, with a clock icon: testing showed a lead waiting on Maya's callback said nothing, so another agent could pick it up and call first · Jeel
- 2026-09-29 · Holding needs no score: a test picked a lead up from Admin > Leads before it answered, and it read Working there but was missing from the queue, even for the admin holding it · Jeel
- 2026-09-29 · Saving an outcome releases the lead, so a closed lead leaves the moment Closed is saved; until then it stayed as "Working – name" until the agent pressed Back to queue, though nobody needed to pick it up · Jeel
- 2026-09-28 · Only leads that need a person: the queue held every responder, a lead halfway through the questions included. Closed leads leave; until then the queue did not read `dispositions`, so a finished lead stayed at the top for the next agent to call again · Jeel
- 2026-09-28 · An unread text became a reason of its own, from review: a lead who never answered a question has a score of 0, so one who texted "please call me" on day 9 - or STOPped, STARTed, then wrote - was flagged for a person and kept out of the queue, where nobody would see it · review
- 2026-09-28 · The tags cut to the few: `new` ("New"), `attempted` ("Attempted 2x") and `callback` ("Callback 3:00 PM") dropped - call history and callback times belong to the agent working the lead, and on the home page they gave every row something to say, so nothing stood out; `new` went with them, or a lead called twice by nobody now holding it would read "New" again. A `stalled` tag ("Stalled at Q1 / Q2") went the same day, since partway leads left the queue. "In progress – Michael" became "Working – Michael", the word Admin > Leads uses, so "In progress" no longer meant two things; the API's `in_progress` became `working` in the code-quality pass that day and gained `agentId`, so the lock matches the holder by id · Jeel
- 2026-09-28 · The screen rebuilt to Jeel's mockup. Was / is: filters and table loose on the page → one card, the head a grey band; three tier pills, several at once → one segmented switcher, one at a time; a coloured tier badge → signal bars and the word; "AGE", amber past 5 minutes and red past 15 for HOT → "WAITING", monospace, one weight and colour (it first kept the brief's thresholds as bold past 15 minutes for HOT, which left the column half dark and showed even on a greyed locked row; `ageTone` in `lib/format.ts`, which held them, went with its tests); coloured status pills → an icon and the words, three statuses at first - Working, Inbound reply, Needs review; the button Pick → Pick up; "Locked" → a padlock and "Locked"; a right-aligned action column → centred; a light-grey button hover → the header's navy, white text; the chosen tier white on grey → navy on a sliding thumb; empty cells `-` (an em dash was tried and reverted); "Live" → "Live · updated just now". Earlier the same day each status had a dot, then a plain dot - Jeel: a dot said only "something". Checked on a separate dev server at 1280, 1366, 1440 and 1920px: the table fits its card at every width, and the switcher shows the right rows with its counts unchanged · Jeel's mockup
- 2026-09-26 · The screen built - Phase 3 tasks 15 and 16 - polling this endpoint every 5 seconds through `frontend/src/api/usePolling.ts` (task 14) · Phase 3
- 2026-09-26 · `POST /api/leads/:id/read` built. Until then nothing unset `has_unread_inbound`, so an expired lead who texted back stayed in the queue however often an agent read the message · Phase 3 task 3
- 2026-09-23 · Live updates asked for: new leads appear by themselves, done by polling this endpoint every 5 seconds as Admin > Leads already did - at 50-100 leads a day an agent cannot tell it from a push, and it needs nothing new on the server · Jeel
- 2026-09-22 · `GET /api/leads` built, sorted by score then age · Week 2 item 9
