# Priority Queue API

`GET /api/leads` - the list agents work down, best lead first. Any signed-in
user; a superadmin sees the same thing.

Screen: `DESIGN-PROMPT.md` section 2. Code: `backend/src/api/leads.ts` (route),
`backend/src/db/queue.ts` (the query), `backend/src/core/queue-tags.ts` (the
tag). Flow rules it depends on: `STATE-MACHINE.md`.

## Who is in it

**Only leads that need a person - Jeel, 2026-09-28.** It used to hold every
responder, a lead halfway through the questions included. But the last
question asks what they want to do next: a lead who has not reached it has not
asked for a call, and one still answering would be interrupted by it. Agents
contact people who have given them a reason to.

A lead is in the queue when its number is not blocked and it needs a person.
`db/queue.ts`, `INCLUDED`, is the rule; rewritten here 2026-10-01 to say what
that SQL says - the two tables it replaced ("always" and "one of") had drifted
from it.

| Never, whatever else is true | Why |
|---|---|
| No live `dnc_list` row for the phone | An opt-out is absolute. A row released by START (`released_at` set) does not count - `STATE-MACHINE.md`, "Opting back in". |

**Three reasons stand on their own** - no score needed, and they keep even a
closed lead in:

| Reason | Why a person is needed |
|---|---|
| An active agent holds it | Being worked. A lead must never vanish from under the agent working it, whatever its conversation says |
| `has_unread_inbound` | Texted something the questions cannot handle - after the conversation ended, or to an agent who took it over. `STATE-MACHINE.md`, "Which replies need a person" |
| An unreturned **missed call** | They rang our number and nobody answered - 2026-10-01. This one needs no reply and no score: a lead who has never texted is in the queue for it. `TWILIO.md`, "A missed call" |

**Three more need a score above 0 and a lead that is not closed.** Scoring
starts at the first reply, so a score is the mark of a responder:

| Reason | Why a person is needed |
|---|---|
| Newest conversation `completed` | Finished the flow's questions, or asked to hear from a rep. **Except** one that ended `offers` - a lead who only asked for special offers is a list for the client's campaigns, not a call to make (2026-10-05) - or `declined`, who said no to the offers and to a rep (2026-10-06). `FLOWS.md`, "What a choice's ending means" |
| Newest conversation `review` | Replied, and we could not understand it |
| A callback is booked and not done | An agent promised a call. This is also what keeps an expired lead with a callback in reach |

*(The unread message became a reason of its own on 2026-09-28, from review: a
lead who never answered a question has a score of 0, so one who texts "please
call me" on day 9 - or STOPs, STARTs, then writes - was flagged for a person
and then kept out of the queue, where nobody would see it.)*

**Holding a lead needs no score - Jeel, 2026-09-29.** Everything else in the
queue has replied (score above 0) or has an unread message. A held lead did
too, until a test picked one up from Admin > Leads before it answered: it read
Working there but was missing from the queue, even for the admin holding it.
Holding now stands on its own (`db/queue.ts`, `INCLUDED`); once let go, such a
lead leaves until it replies.

**A closed lead leaves - Jeel, 2026-09-28.** Once an agent presses Closed,
the three scored reasons above no longer keep the lead - not completing, not
needing review, not a callback booked before it was closed. Saving the outcome also
releases the lead, so it leaves the moment Closed is saved (Jeel, 2026-09-29;
until then it stayed as "Working – name" until the agent pressed Back to
queue, though nobody needed to pick it up). Four things still keep one in:

| Keeps a closed lead in | Why |
|---|---|
| An agent picks it up again | Someone is deliberately working it again |
| `has_unread_inbound` | The lead texted after closing, and a person has to read it. It shows as Inbound reply |
| A missed call nobody has returned | The lead rang after closing and got no answer. It shows as Missed call until an agent calls or texts them, answers when they ring again, or saves an outcome (2026-10-01; `TWILIO.md`, "A missed call") |
| A callback booked after closing, not yet done | It is not finished after all - "call me Friday". That reopens the lead altogether |

"Closed" is defined once, in `backend/src/db/lead-state.ts`, and Admin > Leads
uses the same definition (`ADMIN-LEADS.md`, "Closed"). Before this, the queue
did not read `dispositions` at all, so a finished lead stayed at the top for
the next agent to call again.

A lead partway through the questions is on Admin > Leads, under *Answering*,
and nowhere an agent works from - unless an agent holds it, it has an unread
text, or it rang us and nobody answered. Someone who stops for good expires after the
reply window and never reaches the queue - accepted: they never said how, or
whether, they wanted to be contacted.

Only the newest conversation counts. Older ones are history and are not
consulted, so a lead who completed a second conversation is not dragged back by
the first one having expired.

## The order

`score DESC`, then the most recently received, then id.

Score first is the point of the screen. Freshest next, because speed to contact
is what the score is for - `DESIGN-PROMPT.md` section 2, "sorted by score then
freshness". Id last so the order never wobbles between two identical rows.
The page says so: "Highest score first, then newest."

A lead with no score - held before it answered, or one who rang us and was
missed - sorts to the bottom. The list stops at 100 rows, so in a queue that
long it would not be shown; at 50-100 leads a day it has not come close.

## The tag

At most one tag per row - the STATUS column - computed, never stored. The API
returns what is true and the screen words it: `{ kind: 'working', agentId: 7,
agentName: 'Michael' }` becomes "Working – Michael".

*(It read "In progress – Michael" until later on 2026-09-28. Jeel: Working, the
same word Admin > Leads uses for a lead an agent is on, so "In progress" no
longer means two things. The API's `kind` followed in the code-quality pass the
same day - `in_progress` became `working` - and gained `agentId`, so the lock
matches the holder by id. The queue says Working only while someone holds the
lead, while Admin > Leads keeps saying Working after it is released -
`ADMIN-LEADS.md`.)*

**Few, and most rows have none - Jeel, 2026-09-28.** A tag answers the
two questions an agent scanning the queue has: is somebody already on this, and
why is it here? When several apply, the first wins:

| # | `kind` | Shown when | Carries |
|---|---|---|---|
| 1 | `working` | An **active** agent holds the lead | `agentId`, `agentName` |
| 2 | `missed_call` | The lead rang us, nobody answered, and nobody has got back to them since - `MISSED_CALL_SQL`, `TWILIO.md`. Bold. A held lead still reads Working | |
| 3 | `inbound_reply` | The lead has texted and nobody has read it | |
| 4 | `callback` | A callback is booked and not done - the soonest one. "Callback – Maya Chen · 8:13 PM", with the date when not today. Does not lock the row | `agentId`, `agentName`, `at` |
| 5 | `wants_call` | The lead said No to the first question, then asked to hear from a rep - the flow ended `wants_contact` (2026-10-05). Says why a lead with 10 points is in the queue | |
| 6 | `needs_review` | Conversation `review`: replies we could not read | |
| - | `null` | None of those: the lead is waiting to be picked up. The screen shows a hyphen | |

**Callback came back - Jeel, 2026-09-29.** Testing showed the cost of
dropping it: a lead waiting on Maya's callback said nothing, so another agent
could pick it up and call first. It returns naming whose callback it is, which
answers the first of the two questions - is somebody already on this? It ranks
below an unread reply, which needs reading whoever's call it is.

**What was dropped, and why.** There were three more: `new` ("New"),
`attempted` ("Attempted 2x") and `callback` ("Callback 3:00 PM") - the last
came back the next day, above. Call history
and callback times belong to the agent working the lead - their callbacks are on
My Callbacks, every call is in the lead's timeline - and on the home page they
gave every row something to say, so nothing stood out. `new` went with them:
without the other two, a lead called twice by nobody currently holding it would
have read "New" again.

A booked callback keeps a lead **in** the queue ("Who is in it" above), unless
the lead is closed, and shows as Callback – name · time unless a higher tag
applies.

*(Earlier the same day there was also a `stalled` tag - "Stalled at Q1 / Q2" -
for a lead partway through. Partway leads are no longer in the queue, so it
could never be shown and is gone.)*

One thing worth knowing:

- **A claim by a deactivated agent is ignored.** `assigned_to` is joined through
  `users.is_active`, so deactivating an agent hands their held leads back to the
  floor instead of parking them behind a name nobody can sign in as.

`Seen before, stopped at Qn` is in the mockup and is not built: repeat leads are
a future item, CLAUDE.md §10.

## Filters

`GET /api/leads?tier=&source=&since=&q=&limit=`

| Parameter | Takes | Rejects with |
|---|---|---|
| `tier` | `HOT`, `WARM`, `LOW`, comma-separated, any case | 400 `invalid_tier` |
| `source` | Partner codes, comma-separated | — |
| `since` | `1h`, `24h`, `7d`, `30d`, `all` | 400 `invalid_since` |
| `q` | Name, or phone in any punctuation | — |
| `limit` | Whole number above 0; clamped to 500, default 100 | 400 `invalid_limit` |

A bad filter is refused rather than quietly ignored, so a typo in a link shows
up as an error instead of the wrong queue.

`q` matches first and last name, or the phone with punctuation stripped, so
`(602) 620-3572` finds `+16026203572`. What is typed is escaped before it
reaches `LIKE`: a `%` in the search box is the character, not a wildcard.

## The response

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

`counts` feeds the tier switcher (All, Hot, Warm, Low with their counts), which is also the tier filter, so it is
counted **without** the tier filter - otherwise picking HOT would zero the other
two and the agent would lose sight of what is waiting. `sources` is the dropdown
and is counted without the source filter, for the same reason: picking one
source would otherwise leave it alone in the list with no way back. Every other
filter applies to both.

`total` is how many matched everything asked for, so the screen can say when the
limit cut the list short. It costs no extra query: the tier counts already carry
every other filter, so the selected tiers add up to it.

`receivedAt` is `ezt_added_at`, falling back to `created_at` - when the lead
reached us, which is what the ticking Waiting column counts from.

`answers` is what the lead answered, in their flow's order: one entry per
question answered, with the question's `heading` and the choice's `label` as
they were saved with the answer (`conversation_answers`, `FLOWS.md`) - so a
choice renamed later does not rename what an earlier lead picked. The screen
shows them in one **Answers** column, "Yes · No · Talk to an agent", with the
headings on hover.

*(Until 2026-10-05 a row carried `q1`, `q2`, `q3` and the queue had three fixed
columns, Interest, Timing and Preference. Flows now differ in how many
questions they ask, so there is no fixed set of columns to have.)*

## How fast it is

The queue is asked for every five seconds by every open browser, and whether a
lead belongs in it is worked out from several tables each time - nothing is
stored. So its cost grows with every lead ever received, not with the size of
the queue.

**Timed on 2026-10-06 against 50,000 leads** - about a year and a half at 100
a day - with their answers, messages, calls, notes, callbacks and outcomes
(`backend/scripts/speed-check.ts`, `npm run speed`; a laptop, so compare the
two columns, not the figures with a server's):

| | Before | After |
|---|---|---|
| The queue as it opens | 7.8 s | 0.18 s |
| One tier | 4.6 s | 0.18 s |
| The last 7 days | 0.87 s | 0.01 s |
| A name search | 0.07 s | 0.02 s |

With a few hundred leads both were instant, which is why nothing showed it.
Found by loading the leads on purpose. Three causes, none from the flows
change:

| Cause | Fix |
|---|---|
| "Has a callback been booked since this lead was closed?" read the whole `callbacks` table once per closed lead - it had no index by lead. Most of the time | Migration 013: `callbacks (lead_id)`, and `messages (lead_id)` for agents' own texts |
| The page, the tier counts and the source list were three statements, each working out the whole queue from scratch | One statement. The queue is built once; the counts and the page are both read from it (`db/queue.ts`, `listQueue`) |
| Postgres compiled these statements to machine code before running them, having priced them far above their cost. The compiling took longer than the query | `jit=off` on the app's connections (`db/pool.ts`) |

**Refreshes do not pile up.** The screen asks again five seconds after the last
answer arrived, not every five seconds regardless (`usePolling.ts`). On a
fixed interval a slow server was sent more requests the slower it got.

**What is left grows with the leads.** Each refresh still looks at every lead
once: about 0.18 s at 50,000, so roughly 0.4 s at 100,000. If that ever
matters, the fix is to stop working membership out - to store "needs a
person" on the lead and maintain it - which is a design change, not a tuning
one.

## What this does not cover

- **The STATE column in the mockup is not returned.** EZ Texting sends no state
  with a contact - `EZTEXTING-API.md` - so there is nothing to return. It needs
  a source for that field before the column can be built.
- ~~**No live updates yet.**~~ Built - the note at the end of this item. The
  screen was specified as updating without a refresh, and this was a plain
  request. *(2026-09-23, Jeel: new leads appear by
  themselves. Done by polling this endpoint every 5 seconds, the way
  `ADMIN-LEADS.md` already does - at 50-100 leads a day an agent cannot tell it
  from a push, and it needs nothing new on the server. The fetching goes in one
  place so a real push can replace it later without touching the screens.)*
  **Built 2026-09-26** as `frontend/src/api/usePolling.ts`, Phase 3 task 14 -
  see "The polling hook" below.
- **Claiming is written elsewhere.** `assigned_to` is read here, never written.
  `POST /api/leads/:id/claim` and `/release` do that - Phase 3 task 2,
  `AGENT-WORKSPACE.md`.
- **`has_unread_inbound` is cleared by `POST /api/leads/:id/read`** - Phase 3
  task 3. Until it existed nothing unset the flag, so an expired lead who texted
  back stayed in the queue however often an agent read the message. Proved
  against a real database: such a lead leaves the queue once read, while a lead
  whose conversation is still open stays, because the flag was never what was
  keeping it there. `STATE-MACHINE.md`, "Expiry".
- **No paging.** `limit` truncates and `total` says by how much; at 50-100 leads
  a day the default of 100 holds several days of queue. Page when it does not.

## Proving it

The tag rules and the route have unit tests (`queue-tags.test.ts`,
`api/__tests__/queue.test.ts`). Neither touches the SQL, which is
where most of the rules above actually live, so
`backend/scripts/queue-live-check.ts` seeds one lead per case in a scratch
database and asserts what comes back - inclusion, exclusion, order, every tag,
each filter, the counts. The header of that file says how to run it. 55 checks
as of 2026-10-06, all passing - including a partway lead kept out, and partway
leads kept in because they are held, booked, or taken over and replied to; a
booked callback shows Callback, and call attempts show no tag. The missed call
- in the queue with no score, reopening a closed lead, its tag, and what
settles it - is proved in `scripts/calls-live-check.ts`.

## The polling hook

`frontend/src/api/usePolling.ts`. Every live screen fetches through it: the
queue, the workspace, the timeline, My Callbacks and four admin pages (Leads,
Overview, Configuration, DNC).

```ts
const fetcher = useCallback(() => listQueue({ tier, source, since, q }), [tier, source, since, q]);
const { data, loading, error, refresh, updatedAt } = usePolling(fetcher);
```

**One place, so a push can replace it.** `POLL_MS` is 5000 and the interval
lives here alone. Swapping polling for websockets later means rewriting this
file and nothing else. `admin/LeadsPage.tsx` had its own copy of the interval
before this task and now uses the hook; copying it to eleven more screens is how
a codebase ends up with five different refresh behaviours.

**What it guarantees, and why each one is tested rather than eyeballed:**

| Behaviour | Why it matters |
|---|---|
| `data` survives a tick | The table must not blank out every five seconds |
| `loading` is true only when there is nothing to show | A spinner on every tick makes the screen flicker |
| An error keeps the last good `data` | A dropped connection shows a banner over stale rows, not a blank page - the design brief's "Live updates paused" |
| A stale response is discarded | A slow request from a filter the agent has already changed must not overwrite the current view |
| The timer stops on unmount | Otherwise it polls forever and sets state on a dead component |
| `refresh()` fetches now | So a claim or a note appears at once instead of up to 5s later |
| `keepPreviousData` keeps the old data through a switch | Opt-in, 2026-09-28: Overview's period, this queue's tier and search, Admin > Leads' status, the DNC list's state and My Callbacks' tab. The page stays and the old rows fade while `switching` is true, instead of blanking for a spinner. Faded rows are also unclickable (`.is-switching`), so nobody picks up a lead from the list they just switched away from |

**The fetcher must be stable** - wrapped in `useCallback` with the filters as
dependencies. When it changes that counts as a new view: the spinner returns and
the old rows are cleared, because rows fetched under the old filter do not
belong under the new one. A fetcher rebuilt on every render would clear the data
on every render.

`frontend/src/api/usePolling.test.ts` covers all seven rows above. None of them is
visible in a browser, which is why they are tested at all - the screens
themselves are judged by eye.

## The one-agent lock on screen

`frontend/src/lib/lock.ts`, Phase 3 task 16. The rule is enforced on the
server - `db/claims.ts`, and no screen is trusted with it - but the queue has to
decide which rows to mute before anyone clicks.

A row is locked when its tag is `working` and someone else holds it. Three
ways it is not:

| Case | Why |
|---|---|
| Nobody holds it | The usual case |
| You hold it | Reopening your own claim is the normal way back into a lead; locking an agent out of it would strand them |
| You are a superadmin | They need to see what an agent is stuck on |

A locked row is muted, carries a `Locked` badge instead of a button, has a
tooltip naming the holder, and has no click handler at all - the lock has to be
felt, not only seen.

### What the button offers - 2026-09-28

Not locked is not the same as claimable, and for a while the screen treated them
as the same thing: every unlocked row said **Pick** (now **Pick up**), including rows where the
server would refuse the claim. A superadmin looking at a lead another agent held
got a button that always returned 409. `rowAction()` now answers the narrower
question - what may this person actually do:

| `rowAction` | When | Button | What it does |
|---|---|---|---|
| `pick` | Nobody holds it | **Pick up** | Claims it, opens the workspace |
| `resume` | You hold it | **Resume** | Back into your own lead. Re-claiming your own lead succeeds, but "Pick" implies taking something you already have. While it checks, the button reads *Opening...*, not *Picking up...* |
| `view` | Someone else holds it, you are a superadmin | **View** | Opens the workspace read-only. Claims nothing, and the holder keeps the lead |
| `locked` | Someone else holds it, you are an agent | *Locked* | No action |

**Resume still asks the server, and changes nothing.** It sends the same claim
as Pick. For a lead that is already yours, `db/claims.ts` keeps `assigned_to`
and the original `assigned_at` - the pick time does not move - and only
`updated_at` changes. It asks at all because the queue on screen can be up to
five seconds old: in that gap a superadmin may have released the lead and
someone else picked it, and the claim is what finds out. Checked against the
database 2026-09-28.

**The row and the button do different things - 2026-09-28.** A row click only
ever looks: it opens the workspace read-only, assigns nothing and leaves an
unread reply unread. The button is the only thing that claims, and View opens
the same read-only workspace. Locked rows are still not clickable at all.

**Your own claim is tested before the superadmin rule.** Otherwise a superadmin
working their own lead would be sent to the read-only page for a lead they are
in the middle of.

**`lockHolder()` is derived from `rowAction()`** rather than repeating the rule,
so the muting and the button cannot drift apart.

The same three states are on the Lead Timeline header, decided there by holder
id because `GET /api/leads/:id` returns one.

**A deactivated agent's claim counts as unlocked.** The queue joins `users` on
`is_active`, so such a claim returns no holder and no `working` tag, and
`db/claims.ts` lets anyone take the lead over. Muting it would strand the lead
where nobody could open it. `rowAction()` also treats a `working` tag without a
holder id as unlocked, for the same reason.

**The holder is matched by id** - `agentId` on the tag, against the signed-in
user's id. Until 2026-09-28 the endpoint returned only the name and the lock
compared names, so two agents with the same name each saw the other's lead as
their own "Resume" row and got a 409 on clicking it. Found in review;
`lock.test.ts` covers two agents called "Sam Okonjo".
