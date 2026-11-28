# Several buckets (Phase 8)

**Status:** In progress

The phase is three parts, each able to go live on its own:

| Part | What | Status |
|---|---|---|
| 1 | Several buckets at the same time - tickets B01-B49, [`bucket-tickets/README.md`](bucket-tickets/README.md); the intake tickets wait on the client ("Not done") | In progress |
| 2 | Upload a list of past customers for reminder calls | Paused 2026-11-27 - Part 1 comes first |
| 3 | Screens that make setting up a bucket easy - after Parts 1 and 2 are in use | To do |

A **bucket** is one campaign: the EZ Texting group its leads arrive in, its text
questions, what Seri knows for it - its calls are Seri's - and its missed-call
text. Antibiotics also keeps the robot call script it has today; a new bucket has
none (Jeel, 2026-11-27). The app runs one bucket today, antibiotics; this is the agreed design for
running several at once. Every ticket built from it updates this doc in the same
commit, so it always says what is decided, what is built and what is not. The code
it changes is spread across `backend/src` - "What changes in the code", below.

## How it works

### What each bucket has

- the EZ Texting group its leads arrive in, and its "- taken" group;
- its text questions - a flow (`FLOWS.md`);
- its call lines: the voicemail message, the link text and the stop line and words -
  read by Seri, and by antibiotics' robot script (`AUTO-CALL-SCRIPT.md`, "The
  script"), which no other bucket has;
- its missed-call text;
- what Seri knows for it - a knowledge pack ("Seri with several buckets");
- its own switches: texts, calls, Seri. A new bucket starts with all three off; with
  no robot script, its calls go out only with Seri on.

The antibiotics bucket becomes the first bucket: today's flow and robot script
belong to it, and every lead today is recorded as having arrived in it ("The
database"). It keeps working exactly as today; that is checked before each step goes
live.

### One person, one lead

One person can be in more than one bucket. One person stays one lead, as today
(`STATE-MACHINE.md`, "A number that comes back": "One person is always one lead
row"):

- each bucket a person joins adds a **conversation** to their lead, with that
  bucket's questions, answers, score and automated call;
- the queue shows them once, with their current bucket - the bucket of their newest
  conversation - and the same agent works them across buckets;
- the lead page and timeline show every bucket they have been in;
- a STOP or a do-not-call blocks the number in every bucket.

Rejected: a lead per person per bucket. Dana would be two rows in the queue, two
agents could each pick one and both call her the same day, her history would be
split across two pages, and `leads.phone` would stop being unique - so every lookup
by phone (a text reply, an incoming call, the DNC list) would have to choose between
her leads.

### Active in one bucket at a time

A text reply such as "2" carries no sign of which question it answers, so a person
only ever has one bucket's questions open. The database already allows only one open
conversation per lead (`one_open_conversation_per_lead`, `SCHEMA.md`), which is this
rule.

When a person arrives in a new bucket:

| Their other bucket | What happens |
|---|---|
| Active: text questions still open, an agent holding them, an open callback, or a review conversation | Nothing is sent for the new bucket: no texts, no automated call. They go into the agents' queue as **Needs review · 2 buckets**; the first bucket carries on as normal, so their replies answer its questions |
| Finished or expired | The new bucket starts as normal: its first question, then its automated call |
| Number on the DNC list, or opted out in EZ Texting | Nothing, ever |

An agent who opens a person tagged **Needs review · 2 buckets** sees both buckets on
the lead page and calls them; the tag clears as soon as an agent picks them up.
Nothing starts the new bucket's questions later by itself. `decideArrival` (B22) is
where these rows, and those of the next section, live in code.

### A closed lead joins a new bucket

**Closed** belongs to the whole lead and keeps it out of the queue until one of four
things reopens it (`CLOSED_SQL`, `db/lead-state.ts`). With one lead per person, a lead
closed in antibiotics would stay hidden when it joins weight loss. And Closed alone
could not say whether the bucket should start: it stood for Sold, Not interested and
Wrong number alike.

So **Closed asks why.** Pressing Closed in Wrap up opens a popup with three
choices; the agent picks one and it is saved with the outcome. DNC is unchanged.
Built - B04 (`AGENT-WORKSPACE.md`, "Dispositions"); what a new bucket does with the
reason is B22.

| Closed as | When the person joins a new bucket |
|---|---|
| **Sold** | The new bucket starts: its questions and its automated call, and the lead reopens the normal way, for example when they answer |
| **Wrong number** | Nothing: the phone is not that person |
| **Not interested** | The new bucket starts - they said no to one product, and the partner sent them for another on purpose |

DNC is the outcome for "never contact again": it blocks every bucket, texts and
calls. The reason also lets Admin count leads sold (B05).
A lead closed before Closed asked why - no reason saved - starts a new bucket; one
saved as the retired `wrong_number` does not.

### Finding people: two groups per bucket

**The problem.** EZ Texting keeps one contact per phone number, and a contact can be
in many groups at once. When a contact already on the account joins another group,
nothing on it moves: its `createdAt` stays as it was and there is no `updatedAt`
(`EZTEXTING-API.md`, "One contact per phone number"). The poller finds new contacts
by `createdAt`, so it would never see a known person join a bucket.

**The plan - waiting for the client's OK ("Not done").** Each bucket has two groups:

1. **Antibiotics** - the partner adds new leads here, as today.
2. **Antibiotics - taken** - the app moves each person here once it has taken them
   in. The app creates each bucket's "- taken" group itself, once, then reuses it.

Every cycle, for each bucket, the poller:

1. reads **everyone** in the bucket's main group - only people not yet taken in,
   since the rest were moved out - with no date cutoff;
2. takes each one in by the rules above, writing the lead and conversation first;
3. moves them to "- taken" (`POST /v1/contacts` with `groupIdsAdd` and
   `groupIdsRemove` - the add has been tried on the test account, the remove not
   yet).

A person arriving in two buckets in one read goes to the older bucket - the lower
id; the other holds them.

Example, two buckets, so four groups:

| When | Antibiotics | Antibiotics - taken | Weight loss | Weight loss - taken | What the app does |
|---|---|---|---|---|---|
| Nov 2, 10:00 - partner adds Dana | Dana | | | | - |
| 10:00:30 - poll | | Dana | | | New: her lead, antibiotics question 1, moved |
| Nov 4 - partner adds Dana to weight loss | | Dana | Dana | | - |
| 30 seconds later - poll | | Dana | | Dana | Antibiotics still open: nothing sent, **Needs review · 2 buckets**, moved |

- **Never texted twice.** The person is saved before the move. If the move fails
  they are read again next cycle, and the app sees it already took them in for that
  bucket and skips them.
- **The switch-over.** When the new poller first runs, everyone already in the
  Antibiotics group is moved to "Antibiotics - taken" without a text: the leads the
  app has already taken in, and older contacts it never took in. Only a contact newer
  than the old poller's last checkpoint is taken in as usual, so nobody arriving at
  that moment is lost. Only people added after that are new.
- **What it also fixes.** A number the partner sends again lands in the main group
  again and is seen - the repeat-leads check (`STATE-MACHINE.md`, "A number that
  comes back") is answered by this. So is review R12 (`POLLER.md`): a contact moved
  into the group by hand more than 5 minutes after it was created is never taken in
  today.
- **What it needs.** Nobody uses a bucket's main group for anything else, such as
  sending campaigns to it, since people do not stay in it. True of antibiotics
  today: its group is dedicated, pulled from by us and never sent to by the client
  (review D1, `REVIEW-2026-11-22.md`; `WEBHOOKS.md`, "A lead's reply to another
  campaign").

### Switching a bucket on

While a bucket's texts are off, the poller leaves its group alone and people wait
there. Switching texts on takes in everyone waiting, as on any read: each gets the
first question, however long ago they arrived. Switching on is a person's decision,
like the resend after an outage (`POLLER.md`, "Resending after an outage"); the
24-hour limit stays for what the app does by itself, the opener retry. The rules
above still hold for each: a blocked number gets nothing, and someone active in
another bucket is held.

This is not the switch-over of the antibiotics group (above): that group holds every
lead the app has already taken in, so they are moved to "- taken" without a text. A
new bucket's group holds only people the app has never taken in.

### What follows the lead's bucket

| What | With buckets |
|---|---|
| The first text | The bucket's own first question |
| Replies | The conversation stays on its bucket's questions to the end |
| Score and tier | The bucket's own points, on the one shared scale: its best answers reach 100 (`FLOWS.md`: no lead may pass 100), and HOT, WARM and LOW mean the same in every bucket |
| The queue and Admin > Leads | One list for everyone, with a Bucket column and a Bucket filter. A person's "Received" date is their newest arrival, so someone who comes back for a new bucket counts as new today; on Admin > Leads a held person counts under Needs review |
| Automated calls | Seri, with the bucket's pack and call lines; switched on or off per bucket. A bucket with no robot script places no call while Seri is off; while OpenAI is down the dialler waits, as it does today; if Seri fails during a call she says one goodbye line and the lead goes to the agents (B51). Antibiotics' robot script still takes its calls when Seri is off or fails. "Worked" means worked since this bucket's conversation began, so a new bucket counts as a new lead and gets its own call |
| Missed-call text | The bucket's own wording |
| Seri | The bucket's knowledge pack; switched on or off per bucket |

### Seri with several buckets

There is one Seri, handed the lead's bucket's knowledge pack on each call.

| Part of Seri | Same for every bucket | Per bucket |
|---|---|---|
| Her voice and way of talking | ✓ | |
| Her rules: no prices, no medical advice, two clear no's end the call | ✓ | |
| How she books call backs and puts people through | ✓ | |
| Brand, the offer, how she introduces herself | | ✓ |
| Approved answers and the product list | | ✓ |
| Stop line, link text and voicemail message - the bucket's call lines | | ✓ |

- A lead never hears another bucket's offer or answers.
- Each bucket has its own Seri switch; with it off, antibiotics' calls use its robot
  script, and a bucket with no script places no calls.
- A broken pack stops the API, as a broken knowledge file does today: packs are
  compiled in and every pack is checked by the tests before any merge, so a broken
  one never reaches the server.
- An improvement to how she talks, listens or books call backs helps every bucket at
  once.

What is built in for antibiotics today - the eDrugstore brand, the "up to 25% off"
offer, some answers - moves into the antibiotics pack once, as part of this work. A
new bucket's Seri is copy, edit, test, then switch on: it needs its own approved
answers and a round of testing before her switch goes on.

### What each new bucket needs from the client

- [ ] The EZ Texting group its leads arrive in
- [ ] The text questions, the answer choices, the reply to each, and the points - the best answers reaching 100
- [ ] The voicemail message, the link to text and the stop wording
- [ ] The missed-call text
- [ ] For Seri: the brand and offer, approved answers to the questions people ask, and the product list

Waiting for this content usually takes longer than the building, so it is asked for
early.

## Rules

1. **One person, one lead.** `leads.phone` stays unique; a bucket adds a
   conversation, never a lead.
2. **Active in one bucket at a time.** A person with one bucket active gets nothing
   from another until it is not.
3. **Never texted twice.** A person is saved before they are moved, and a person
   already taken in for a bucket is skipped.
4. **Antibiotics keeps working exactly as today** at every step; checked before each
   step goes live.
5. **Each fact lives in one place.** What a new table takes over moves into it in
   the same migration, and the old column or row is then removed - its values
   copied first, so nothing is lost (`AUDIT.md`).
6. **The database enforces the rules,** not only the code: every link a foreign
   key, every "only one" a unique index, every fixed set of values a check.
7. **History is add-only,** as everywhere else: arrivals and outcomes are never
   deleted or rewritten - an arrival only has its `moved_at` filled in, once - and
   every switch is recorded in `activity_log`.
8. **Tags stay computed** from the tables, never stored (`QUEUE.md`).

## Data

### The database

Every database change is a new numbered migration - the next number is in
`WORKFLOW.md`, "Where the files stand". Rules 5-8 apply. When each table is built, its columns move into `SCHEMA.md` (B07, B09); until
then they are here.

**New: `buckets`** - one row per campaign.

| Column | What |
|---|---|
| `id`, `name` | "Antibiotics"; the name is unique |
| `ezt_group_id`, `ezt_group_name` | The main group the partner adds leads to; unique |
| `ezt_taken_group_id`, `ezt_taken_group_name` | The "- taken" group; unique |
| `knowledge_key` | Seri's pack, the folder `backend/src/ai/knowledge/<key>/`. Her knowledge stays in the repo, changed by a reviewed PR |
| `missed_call_text` | Moved from `settings.message_missed_call` |
| `texts_on`, `calls_on`, `ai_agent_on` | Its three switches, each change in `activity_log`; `ai_agent_on` moved from `settings.ai_agent` |
| `voicemail_body`, `link_text`, `opt_out_body`, `opt_out_words` | Its call lines, moved from `call_scripts` (copied, then removed), read by Seri and by antibiotics' robot script - one place for every bucket (B50) |
| `created_at` | |

**New: `bucket_arrivals`** - add-only, one row each time the poller takes a person in
for a bucket. Today a known phone is skipped and leaves no trace.

| Column | What |
|---|---|
| `lead_id`, `bucket_id` | Who arrived, in which bucket |
| `arrived_at`, `ezt_added_at`, `source` | When we took them in, the contact's `createdAt`, and its source |
| `result` | `started`, `held` (active in another bucket - the **Needs review · 2 buckets** tag), `blocked` (DNC or opted out), `wrong_number`, `mid_flow` (already open in this bucket) - a check |
| `conversation_id` | The conversation it started, when it started one |
| `moved_at` | When the person was moved to "- taken"; empty until then |

One arrival without `moved_at` per person and bucket (a unique index): a move that
failed is retried on the next read, never a second arrival and never a second text.
The first arrival is what `leads.source`, `group_id`, `group_name` and
`ezt_added_at` hold today; one arrival per existing lead is written from them, then
those columns go. So does `leads.previous_lead_id`, never used (`SCHEMA.md`).

**Changed:**

| Table | Change |
|---|---|
| `flows` | `bucket_id`, required. One active flow per bucket, in place of one overall. `flows.ezt_group`, never read, goes |
| `call_scripts` | `bucket_id`, required. `call_scripts_one_active` becomes one active per bucket - only antibiotics has one; a new bucket has none. The voicemail, link and stop lines leave it for `buckets` (B50) |
| `conversations` | No new column: the bucket is its flow's, so the two cannot disagree |
| `calls` | `conversation_id` on an automated call. `calls_one_automated_per_lead` becomes one per conversation, keeping its `not_placed` exception |
| `dispositions` | `reason` - why a Closed was closed - and `conversation_id`, the bucket it closed: built by B04, so in `SCHEMA.md`. The route requires the reason from B19 |
| `settings` | `message_missed_call` and `ai_agent` move into `buckets`. The robot's hours stay one setting for all, unless the client answers otherwise |

The antibiotics bucket is created, and everything above filled in for it, in the
same migration that adds the tables.

## Code

### What changes in the code

| Area | Today | With buckets |
|---|---|---|
| Which group is read | One, from `EZT_GROUP` in `.env` (`config.ts`) | Each bucket's group, from the database |
| How new people are found | `createdAt` newer than the checkpoint, minus 5 minutes (`POLLER.md`) | Everyone in the bucket's main group, then moved to "- taken" |
| Which contacts count | Only the source in `EZT_SOURCE` - `API` in production | Unchanged; a contact of another source is left where it is |
| `leads` | One per phone (`phone` unique, 001) | Unchanged |
| `conversations` | One open per lead (001) | Unchanged; its bucket comes from its flow |
| `flows` | One active (`is_active`); `flows.ezt_group` exists but is not read (012, `FLOWS.md`) | One per bucket |
| `call_scripts` | One active (`call_scripts_one_active`, 015) | Antibiotics' only; a new bucket has none |
| `calls` | One automated call per lead (`calls_one_automated_per_lead`, 014) | One per conversation, so each bucket gets its call |
| Missed-call text | One `settings` row, `message_missed_call` | One per bucket |
| Seri's knowledge | Three files in `backend/src/ai/knowledge/` | A pack per bucket |
| Seri's switch | One `settings` row, `ai_agent` | One per bucket |
| Queue, Admin > Leads | No bucket | Bucket column and filter; the **Needs review · 2 buckets** tag |
| Wrap up's Closed | Asks why - Sold, Not interested or Wrong number - and saves it with the outcome (B04) | The reason decides whether a new bucket starts (B22) |
| A closed lead | Reopened by four things (`CLOSED_SQL`) | Also by a new bucket starting, when closed as Sold or Not interested |
| Admin > Configuration | Shows the one bucket | A bucket picker at the top; the Calls tab shows that bucket's calls and Seri switches, and its robot script if it has one |

Which ticket changes which file, in which order, is the tracker's,
[`bucket-tickets/README.md`](bucket-tickets/README.md), "The order" - the order that
counts, split finer than the three steps of Part 1: buckets and texts first, then
calls per bucket - Seri's for every new bucket - then Seri per bucket.

## Tests

| What | Where |
|---|---|
| Every constraint of each new migration, against a real Postgres | A live check, as for every migration since 012 |
| A migration that fills in existing rows, on a copy of today's data | The upgrade check (B03) |
| Each row of the arrival tables above | Unit tests on `decideArrival`, one per row (B22) |
| Two buckets end to end: a held person, each bucket's words, calls only where on, a bucket with no script called only by Seri | `npm run e2e`, across a test bucket (B43) |
| Every path on the test account | B45 |
| The antibiotics bucket exactly as today, before each step goes live | The gates in the tracker, "The rules every ticket keeps" |

## Not done

The tracker has every ticket's state. Beyond Part 1's tickets:

- **Waiting on the client: two groups per bucket.** Is it OK for the app to move
  leads into a "- taken" group once it has taken them in? Is a bucket's main group
  used for anything else, such as campaigns? When this starts, may everyone already
  in the Antibiotics group be moved to "Antibiotics - taken" without a text? This is
  proposed, not decided; the intake tickets wait on it. **If the client says no:**
  the poller reads each bucket's whole group every few minutes and skips people it
  already has. It changes nothing on EZ Texting, but the groups only grow - at about
  100 leads a day a group holds some 36,000 contacts after a year, about 180 requests
  at 200 a page for each read of each bucket.
- **Waiting on the client: the rest.** The tracker's "Waiting on" says which tickets
  each blocks.
  - *Staff and hours:* will the same call center staff handle every bucket, or each
    bucket its own team? Should automated calls for every bucket use today's hours,
    11 AM to 5 PM Arizona time, Monday to Friday? A team per bucket means the queue,
    the transfers and who is free are all split by bucket.
  - *Calling number:* one phone number for all buckets, or one each? A number per
    bucket means more setup.
  - *Brand:* is every bucket the eDrugstore brand? A different brand needs a
    different introduction for Seri, and maybe a different name.
  - *The next bucket:* which comes next, and when can the client send its content
    ("What each new bucket needs from the client")?
- **Part 2: upload a list and call it - paused.** Part 1 comes first; what follows
  records the client's answers so far, for when it is picked up.
- **Part 3: easy setup - later.**

### Part 2: upload a list and call it

A superadmin uploads a list of past customers, and the robot calls each with a
reminder. The client's answers:

| Question | Answer |
|---|---|
| The file's columns | Customer ID, First Name, Email, Phone, Product |
| Calls or texts | Calls only: these customers have no SMS approval - so no texts of any kind, not the link after the call nor the missed-call text |
| Who talks on the call | Nobody: the calls are reminders, never Seri |
| A second call | Yes, a second call or a time to call back |
| List size | Up to 100,000 people |

What the answers mean for the build:

- Each list can be a bucket of its own. Its reminders are fixed calls, not
  conversations - the client's answer: never Seri - so Part 2 brings back a script
  per list, built on antibiotics' robot script code; Part 1's new buckets have none.
- A second call breaks today's one robot call per lead
  (`calls_one_automated_per_lead`).
- The texts the app sends on its own - the missed-call text, the link after a "yes"
  (`db/lead-texts.ts`) - must never reach a list's people.
- 100,000 people in one list is twice what the speed check loads in total (50,000
  leads, `npm run speed`); whether list people are leads or their own table is
  decided first. Reminder calls go to nobody, so their pace is not tied to the people
  free, as the robot's is (`AUTO-CALLS.md`, "Traffic").

The plan when it is picked up: upload a CSV and name the list; a preview (to call,
repeated in the file, bad numbers, on the DNC list); then start or save it. A Lists
page shows each list's progress - called, answered, voicemail, second calls to come -
with pause and resume. A list's people do not fill the agents' queue; an agent sees
one only when they call back.

Still open with the client:

- [ ] **The reminder call:** what does it say, and can the person do anything on it, such as press a key to reach a person?
- [ ] **The second call:** how many days after the first, at what time of day, and does a voicemail left on the first count as reached?
- [ ] **Calling hours:** today's robot hours, or each person's own time zone?
- [ ] **Pace:** a 100,000-person list called within a day, or over several?
- [ ] **Customer ID and Email:** only kept and shown, or used for anything else, such as matching a customer across lists?

### Part 3: easy setup

With several buckets, sending every wording change through a developer gets slow.
Part 3 adds screens for everyday changes, on one rule: **the screens change what Seri
and the scripts say, never how they behave.**

- A new bucket by copying an existing one, its EZ Texting group picked from a list,
  everything starting off.
- Editing the words of the texts, the robot lines, and Seri's approved answers,
  products and offer - saved as a draft first.
- Checks before anything goes live: each text in one message (160 characters) and
  keeping the STOP wording; each Seri answer checked for prices, medical advice and
  made-up offers, with at least three example questions.
- "Check Seri": her answers tested before they go live; publishing stays locked
  until she passes.
- "Test on my phone": the bucket's first text, or a robot or Seri call, to a
  superadmin's own phone.
- Publishing keeps every version, who changed what and when, with a one-click
  restore.
- A checklist and switches per bucket.

What stays with a developer: adding or removing questions, points and the order of
questions, Seri's rules and way of talking, and a new bucket's first Seri setup -
rare changes, where a mistake breaks a live script.

Still open: who may edit wording - superadmins only is suggested, with Seri's answers
kept to one person. This reverses "Admin is read-only" (`ADMIN.md`) for wording
only, and is decided when Part 3 starts.

## Decisions

| Decision | By | Date |
|---|---|---|
| Each bucket has its own text questions, robot script and Seri answers | Client | 2026-11-25 |
| One person can be in more than one bucket, with no restrictions | Client | 2026-11-25 |
| Part 1 comes first; Part 2 is on hold | Jeel | 2026-11-27 |
| A person is active in one bucket at a time. Arriving in a second bucket while the first one's text questions are open sends nothing, and puts them in the queue as **Needs review · 2 buckets** | Jeel | 2026-11-27 |
| One person is one lead. Each bucket they join adds a conversation to that lead, and the same agent works them across buckets | Jeel | 2026-11-27 |
| Pressing Closed opens a popup asking why: Sold, Not interested or Wrong number. A new bucket starts for a lead closed as Sold or Not interested, never for Wrong number. The popup and the reason built - B04 | Jeel | 2026-11-27 |
| One score scale for every bucket: each bucket's points are written so the best answers reach 100, and the tiers - HOT 75-100, WARM 45-74, LOW 1-44 - stay shared, so one queue sorts fairly | Jeel | 2026-11-27 |
| Switching a bucket's texts on texts everyone who waited in its group while it was off, however long ago they arrived | Jeel | 2026-11-27 |
| The database is kept clean: each fact in one place - what moves to a new table is copied, then removed from the old place - and every rule enforced by the database itself | Jeel | 2026-11-27 |
| The **Needs review · 2 buckets** tag clears when an agent picks the person up, as Inbound reply does; on Admin > Leads a held person counts under Needs review | Jeel | 2026-11-27 |
| "Active" in a bucket means: its text questions are open, or an agent holds the person, or they have an open callback, or a review conversation - an active person's new bucket is held | Jeel | 2026-11-27 |
| A person's "Received" date is their newest arrival, so someone who comes back for a new bucket counts as new today | Jeel | 2026-11-27 |
| "Worked" means worked since this bucket's conversation began: a new bucket counts as a new lead and gets its own call | Jeel | 2026-11-27 |
| New buckets have no robot call script: their calls are Seri's. While OpenAI is down the dialler waits; if Seri fails during a call she says one goodbye line and the lead goes to the agents. Antibiotics keeps its robot script as it is | Jeel | 2026-11-27 |
| A lead closed before Closed asked why (no reason saved) starts a new bucket; one saved as the retired "Wrong number" does not | Jeel | 2026-11-27 |
| A person arriving in two buckets in one read goes to the older bucket (the lower id); the other holds them | Jeel | 2026-11-27 |
| A broken knowledge pack stops the API, as today - packs are compiled in and checked by the tests before any merge, so a broken one never reaches the server | Jeel | 2026-11-27 |
| The app creates each bucket's "- taken" group itself, once, then reuses it - only after the client's OK | Jeel | 2026-11-27 |

The queue's order - tier first, then newest, after the promised calls - was decided
while planning this phase but is not bucket work: it is `QUEUE.md`'s decision, built
on its own by B01.

## History

- 2026-11-28 · Status In progress: B01-B06 are built. "Nothing is built" taken out; the next migration number left to `WORKFLOW.md` - it read 025, which B04 used; the `dispositions` row and Wrap up's Closed say what B04 built - the row had read "required on a new Closed by the route; and `conversation_id`, the bucket it closed. Rows from before stay as they are", and Wrap up's Closed "`closed`, no reason" · review of B01-B06
- 2026-11-28 · Closed asks why, built: the popup and `dispositions.reason`, with each outcome's conversation (B04). The new bucket's use of it is B22 · B04
- 2026-11-27 · New buckets get no robot call script - their calls are Seri's, with a goodbye line and the agents' queue when she fails, and the dialler waiting while OpenAI is down; antibiotics keeps its script. The call lines (voicemail, link, stop) move to `buckets`; B48 dropped, B50 and B51 added · Jeel
- 2026-11-27 · Rewritten to the area template, with a Status line in the fixed words: the two-groups proposal moved from Decisions to Not done as an open question; the queue-order decision handed to `QUEUE.md`; Parts 2 and 3 under Not done; the order of work replaced by the tracker's "The order", and the client's questions linked to its "Waiting on"; "before Part 1 starts" dropped - the tracker lets about forty tickets start before the client answers · D45
- 2026-11-27 · Part 1 split into 49 tickets, B01-B49 (`bucket-tickets/`). A broken knowledge pack now stops the API, as today - it had read "switches off that bucket's Seri only". Decided with Jeel: the tag, "active", "Received", "worked", an old Closed, two buckets in one read, the "- taken" group; and the queue's order (`QUEUE.md`)
- 2026-11-27 · On the test account, a contact joining another group moves neither `createdAt` nor anything else (`EZTEXTING-API.md`); the two-group plan written, and `groupIdsAdd` tried - `groupIdsRemove` not yet. Part 2 put on hold (Jeel)
- 2026-11-25 · Planned: the client's answers - each bucket its own questions, script and Seri answers; one person in several buckets; Part 2's file, calls only, no Seri, a second call, up to 100,000 people
