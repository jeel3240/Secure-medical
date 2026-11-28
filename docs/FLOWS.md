# Flows

A **flow** is the script a lead is taken through by SMS: what it asks, the
choices for each question, what we reply, how many points each answer is worth,
and where the lead goes next. Flows are rows, not code (migration
`012_flows.sql`); this doc is how they are stored, the flows there are, and how
to add or change one. What a reply does - opt-outs, unclear replies, scoring,
expiry - is `STATE-MACHINE.md`. The code is `backend/src/db/flows.ts` (reads a
flow, starts a conversation), `backend/src/core/state-machine.ts` (follows it)
and `backend/src/api/reply-flow.ts` (saves the answer).

## How it works

### The guide and the answers

Three tables are the **guide** - small, written by a migration, the same for
every lead: `flows`, one row per script; `flow_questions`, what it asks;
`flow_choices`, each question's choices with the reply, the points, and where
the lead goes next - a `next_question_id`, or an `ending`. The fourth,
`conversation_answers`, holds the **real values**: one row per answer a lead
gave, with the choice's label and points as they were at that moment.
`conversations` says where each lead is now - which flow, which question, the
score and tier, and how the flow ended. The columns are in `SCHEMA.md`.

Think of an exam: `conversations` is the cover sheet - who, which question they
are on, the total mark. `conversation_answers` is the answer sheet.

### How a reply moves a lead

1. The lead's conversation says which flow, and which question they are on.
2. The reply is matched against that question's choices: the number, one of the
   choice's words, its label, or the option as it was printed
   (`STATE-MACHINE.md`, rule 3).
3. The matching choice gives the label, the points, the reply text and the next
   question.
4. One row is written to `conversation_answers`; the conversation moves to the
   next question, or ends.

No match is an unclear reply. The system never looks for an empty column or
counts questions: it follows `next_question_id` until a choice has an `ending`.
A flow with two questions and one with five are the same code.

### What a choice's ending means

| `ending` | Means | Completion award | For agents |
|---|---|---|---|
| `completed` | The questions are answered | Yes | Yes |
| `offers` | Wants offers only | No | No |
| `wants_contact` | Asked to hear from a rep | No | Yes |
| `declined` | Wants neither offers nor a rep | No | No |

The two that are not for agents are one list in the code, `NOT_FOR_AGENTS`
(`core/state-machine.ts`), which the queue reads. How each ending shows is
owned by the screens: in the queue (`QUEUE.md`, "Who is in it" and "The tag" -
`wants_contact` is tagged Wants a call) and on Admin > Leads (`ADMIN-LEADS.md`,
"Status" - Offers, Not interested).

A new ending is added in three places for the flow to run: the two `CHECK`s in
the migration, the `Ending` type, and - if agents should not see it - that
list. For it to have its own status on Admin > Leads and its own words on the
lead card and the timeline, also: `STATUS_SQL` and `LeadStatus` in
`db/leads.ts`, the status list in `api/admin/leads.ts`, and on the frontend the
`LeadStatus` type in `api/leads.ts`, `components/LeadStatus.tsx`, the tabs in
`pages/admin/LeadsPage.tsx`, `components/Timeline.tsx` and
`pages/workspace/LeadHeader.tsx`. Without the first of those the lead reads
Ready.

### `position` is not "what comes next"

`position` is display order, and the lowest is the question a new lead is
sent. Where a lead goes after an answer is the choice's `next_question_id`.
That is what makes a branch possible: "Yes" on the first question skips its
sub-question and goes straight to the second.

### Naming a question, and sub-questions

A question's `key` is its name, and the screens read it from there
(`core/questions.ts`, one rule for every screen):

| Key | Is | Shown as |
|---|---|---|
| `q1`, `q2`, `q3` | A question on the main line | Q1, Q2, Q3 |
| `q1-a`, `q1-b` | A **sub-question** of question 1: asked only after some answer to it | Q1-a, Q1-b |
| anything else | - | The question's `heading` |

**Positions go in tens** - 10, 20, 30 for the main line - **and a sub-question
sits behind its parent**: `q1-a` is 11, `q1-b` 12. So the questions list in the
order a lead can meet them - Q1, Q1-a, Q2, Q3 - a sub-question that leads back
into the main line still leads forward, and one added later needs no other row
renumbered.

A flow may have as many sub-questions as it needs, under any question. A
sub-question of a sub-question has no name in this scheme; give it the next
letter under the same parent.

### The antibiotics flow

eDrugstore antibiotics, the client's script, and the flow new leads get
(`flows.key = 'antibiotics'`, active). It is migration 012, section 5, word for
word. A choice's reply and the question after it go out as **one text**.

| Key | Position | Heading | The question |
|---|---|---|---|
| `q1` | 10 | Requested info | eDrugstore: Hi {first_name}, did you recently request more info about ordering antibiotics online? Reply 1. Yes, 2. No. Reply STOP to opt out. |
| `q1-a` | 11 | Offers | Would you like to receive special offers from eDrugstore? Reply 1. Yes for offers, 2. Learn more from a rep, 3. No thanks, or STOP to unsubscribe. |
| `q2` | 20 | Used telemedicine | Have you used telemedicine to get prescription medication before? Reply 1. Yes, 2. No. |
| `q3` | 30 | Next step | Ready to move forward? Reply 1. I know which antibiotic I need, 2. Talk to an agent for options & discounts, 3. Order online. |

| Question | Choice | Label | Points | Reply | Then |
|---|---|---|---|---|---|
| `q1` | 1 | Yes | 20 | Great! Let's get you started. | `q2` |
| `q1` | 2 | No | 0 | No problem. | `q1-a` |
| `q2` | 1 | Yes | 15 | Great. eDrugstore makes the online consultation process simple. | `q3` |
| `q2` | 2 | No | 5 | No problem. You can complete your information online and, when required, consult with a licensed healthcare provider. | `q3` |
| `q3` | 1 | I know which antibiotic | 30 | Great. Start your online consultation here: https://www.edrugstore.com/anti-ez | ends `completed` |
| `q3` | 2 | Talk to an agent | 45 | Thanks! An eDrugstore representative will contact you to discuss available options, pricing and discounts. | ends `completed` |
| `q3` | 3 | Order online | 10 | Great! Start your online order and consultation here: https://www.edrugstore.com/anti-ez | ends `completed` |
| `q1-a` | 1 | Special offers | 0 | Thanks! You'll receive special offers from eDrugstore. Reply STOP to opt out. | ends `offers` |
| `q1-a` | 2 | Learn more | 0 | Thanks! An eDrugstore representative will contact you shortly. | ends `wants_contact` |
| `q1-a` | 3 | No thanks | 0 | No problem. Thanks for your time. | ends `declined` |

Replying at all earns 10, once; an ending of `completed` earns 10 more. The
review text, after a second unclear reply on any question, is "Thanks! An
eDrugstore representative will follow up with you directly." The tiers are the
shared bands (`STATE-MACHINE.md`, "Scoring").

| Path | Score | Tier | Ending |
|---|---|---|---|
| Yes, Yes, Talk to an agent | 100 | HOT | `completed` |
| Yes, No, Talk to an agent | 90 | HOT | `completed` |
| Yes, Yes, I know which | 85 | HOT | `completed`, with the link |
| Yes, No, I know which | 75 | HOT | `completed`, with the link - the lowest HOT; one point less is WARM |
| Yes, Yes, Order online | 65 | WARM | `completed`, with the link |
| Yes, No, Order online | 55 | WARM | `completed`, with the link |
| No, then Special offers | 10 | LOW | `offers` |
| No, then Learn more | 10 | LOW | `wants_contact` |
| No, then No thanks | 10 | LOW | `declined` |

**`q1-a` is the offers question: a sub-question of question 1**, asked only of
a lead who said No to it.

**The words each choice accepts** (`flow_choices.words`), as the whole reply in
any case - besides the number, the choice's label and the option as printed
(`STATE-MACHINE.md`, rule 3):

| | Choice 1 | Choice 2 | Choice 3 |
|---|---|---|---|
| `q1` | yes, y, yeah, yea, ya, yep, yup, yes please, sure, ok, okay, correct | no, n, nope, nah, no thanks, no thank you | - |
| `q2` | yes, y, yeah, yea, ya, yep, yup, yes please, i have | no, n, nope, nah, never, not yet | - |
| `q3` | i know, know, i know which one | agent, talk, call, call me, talk to an agent | online, order, order online |
| `q1-a` | yes, y, yeah, yea, ya, yep, yup, yes please, offers, offer | learn more, learn, more, learnmore | no, n, nope, nah, no thanks, no thank you, not interested |

**The unclear-reply texts** (`flow_questions.clarify_body`):

| Question | Text |
|---|---|
| `q1`, `q2` | Sorry, please reply 1 for Yes or 2 for No. |
| `q3` | Sorry, please reply 1. I know which antibiotic I need, 2. Talk to an agent, or 3. Order online. |
| `q1-a` | Sorry, please reply 1 for offers, 2 to learn more from a rep, 3 for no thanks, or STOP to unsubscribe. |

**Two texts run past 160 characters** and are billed as two segments: the
replies to `q2` joined with `q3` - 189 and 243 characters. They are kept as one
text anyway, so a reply and its question cannot arrive out of order. The reply
to No on `q1` joined with `q1-a` is 158 - one segment. Admin > Configuration
shows each text as sent, with its segment count (`ADMIN.md`, "Configuration").

### How to add one

A flow is added by a **migration that only inserts rows**. No table, no column,
no code.

1. Insert the flow into `flows`, with `is_active = false`.
2. Insert its questions into `flow_questions`: keys `q1`, `q2`... and `q1-a` for
   a sub-question; positions in tens, a sub-question behind its parent
   ("Naming a question, and sub-questions", above).
3. Insert each question's choices into `flow_choices`, with the flow's id and
   `next_question_id` or an `ending`.
4. To make it the one new leads get: set the old flow's `is_active` to false and
   the new one's to true, in the same migration.

`012_flows.sql`, section 5, is the pattern to copy. `scripts/flows-live-check.ts`
does exactly this with a throwaway five-question flow that has a branch, and
walks leads through it.

Check before shipping one:

- Every text against the 160-character segment limit. A choice's reply and the
  next question go out as one text; Admin > Configuration shows each as sent,
  with its segment count.
- **The first question introduces itself**: the sender's name, the reason for
  the text and the opt-out, with `{first_name}` filled in at send time - as the
  antibiotics opener does, and the first flow's did, from the mockup's page 2. A
  first text that is only the reply options reaches a lead as an unexplained
  menu from an unknown number.
- **Reply words are not reserved by EZ Texting.** It answers STOP, HELP and INFO
  itself. STOP still reaches us, and blocks the number; a lead who sends INFO
  gets the account's own help text and never ours. Text a new keyword to the
  account before using it.
- The points against the tier bands (`tiers`): HOT starts at 75. **The most a
  lead can score must not pass 100** (rule 9).
- Every choice leads forward, to a later `position` (rule 8).

### Changing a flow

Also a migration. Leads already partway through are affected the moment it
runs, so:

- **Rewording** a question, a reply or a label is safe. Saved answers keep the
  label they had.
- **Changing points** changes what the next answer earns. Saved answers keep
  theirs, and a finished lead's score does not move.
- **Changing a flow's two awards** - for replying, for finishing - is the one
  change that shows on old leads: their score stays, but the breakdown's
  "Responded" and "Completed" lines are read from the flow as it is now, so the
  lines stop adding up to the score. An answer's line is unaffected.
- **Removing a question** that a conversation is on, or that anyone has
  answered, is refused by the database (foreign keys). Add a new flow instead
  and make it active; leads in the old one finish there.
- **Removing a choice** is not refused, and loses nothing already said: an
  answer carries its own copy of the label and the points. Leads still on that
  question can no longer pick it.

Making another flow active changes what **new** leads get (rule 10).

## Rules

### Rules the database enforces

1. **One flow is active** - the one new leads get (`flows_one_active`).
2. **A choice either leads to a question or ends the flow**, never both and
   never neither (`flow_choices_next_or_end`).
3. **A choice belongs to one flow, and can only lead to a question of that
   flow** (`flow_choices_next_in_flow`). That is why a choice carries `flow_id`
   as well as its question: the database can then hold both the question and
   the next question to it. Without it a choice could point into another flow
   and a lead would be sent a question that is not theirs.
4. **A conversation is only ever on a question of its own flow**
   (`conversations_question_in_flow`).
5. **A flow awards something for replying** (`responded_points > 0`, with no
   default). "Has replied" is read everywhere as "score above 0" - the queue,
   the lead card - so a flow that gave nothing for a reply would hide its own
   leads.
6. **A question is answered once in a conversation** (unique on conversation
   and question).
7. **A saved answer cannot be edited or deleted** - the same trigger as the
   activity log. It is a record of what someone said.

### Rules the code keeps

8. **A choice may only lead forward** - to a question with a higher `position`.
   So a flow cannot loop, a question is asked once, and a lead's score is the
   sum of its answers. The database cannot check this one; the state machine
   does, and sends a lead who meets such a row to a person instead of asking
   again (`STATE-MACHINE.md`, rule 3).
9. **The most a lead can score must not pass 100.** The tier bands end there,
   the screens say "/ 100", and a score above it has no tier.
10. **A lead stays in the flow it started in.** Making another flow active
    changes what new leads get, never a conversation already running.
11. **A flow is changed only by a migration**, with a PR and a review - the
    rule for scoring and copy (`ADMIN.md`). The tables are what an editing
    screen would change; there is none.

## Data

- **Reads and writes:** `flows`, `flow_questions`, `flow_choices` (read on
  every reply, never cached, so a migration's change applies to the next
  reply), `conversation_answers` (one row per answer, written once) and
  `conversations` (`flow_id`, `current_question_id`, `step`,
  `question_sent_at`, `end_outcome`). Columns: `SCHEMA.md`.
- **Kept, no longer read** - the first flow's storage, from before flows were
  rows. Nothing was deleted:

| Where | What |
|---|---|
| `conversations` | `q1`, `q2`, `q3` and `q1_label`, `q2_label`, `q3_label` |
| `settings` | `question_1..3`, `message_clarify_1..3`, `message_thanks`, `message_review` |
| `scoring_rules` | the whole table |

- **The wellness flow.** The health & wellness flow those rows described was
  copied into the flow tables as the inactive flow `wellness`, and every answer
  already given was copied into `conversation_answers` under it.

## Code

| File | What it does |
|---|---|
| `backend/src/db/flows.ts` | `loadFlow`; `startConversation`, a new lead on the active flow's first question; `openingQuestion` |
| `backend/src/core/state-machine.ts` | `step` follows a flow; the `Ending` type and `NOT_FOR_AGENTS` |
| `backend/src/core/answers.ts` | `matchChoice` - a reply against one question's choices |
| `backend/src/api/reply-flow.ts` | Loads the conversation and its flow, runs `step`, saves the answer row |
| `backend/src/core/questions.ts` | `questionShort` - "Q1", "Q1-a", or the heading |
| `backend/src/core/score-breakdown.ts` | The breakdown from the saved answers and the flow's awards |
| `backend/src/db/admin-config.ts` | Admin > Configuration's copy, scoring and maximum score, from the active flow |
| `backend/src/db/migrations/012_flows.sql` | The tables, the `wellness` flow carried over, the antibiotics flow |
| `backend/src/core/flow-fixtures.ts` | The antibiotics flow as a constant, for tests only |

## Tests

| What | Where |
|---|---|
| Every branch of the antibiotics flow, every rule, and a five-question flow on the same code | `backend/src/core/state-machine.test.ts`, `backend/src/core/answers.test.ts` |
| The webhook walking the flow: the answer row, the joined text | `backend/src/api/__tests__/webhooks.test.ts` |
| A second flow added as rows only, with a branch; a lead staying in its own flow; what the migration seeded | `backend/scripts/flows-live-check.ts` |
| A saved answer keeping its label and points after the flow changes; that it cannot be edited | `backend/scripts/lead-detail-live-check.ts` |
| The queue: offers leads out, Wants a call tagged, a row's answers | `backend/scripts/queue-live-check.ts` |
| Admin > Leads' Offers status; Configuration reading the active flow | `backend/scripts/admin-leads-live-check.ts`, `backend/scripts/admin-live-check.ts` |

`backend/scripts/live-checks.sh` runs every live check on its own scratch
database.

### Testing a flow with one phone

A real walk needs a real phone, and every path of a flow is several walks.
`npm run dev:ask-again` (`backend/scripts/dev-ask-again.ts`) asks a lead we
already hold the questions again, from the first, so one phone can walk every
path - local only. How to use it is in `TESTING.md`.

## Not done

- **Editing a flow from the website.** A flow is changed by a migration (rule
  11). The tables are what such a screen would edit; it is a later phase.
- **Several flows at once.** One flow is active. `flows.ezt_group` is there to
  give each EZ Texting group its own flow; the poller does not read it. Planned
  as Phase 8, a flow per bucket - `BUCKETS.md`.
- **A question that is not a choice** - a date, a free-text answer. Every
  question is a list of choices.
- **The maximum score** on Admin > Configuration is the awards plus the best
  answer to each question. With a branch a lead cannot reach every question, so
  for some flows it reads higher than any lead can score. For antibiotics it is
  exact.
- **Rescoring.** Nothing rescores old leads when points change.
- **A change to a flow's two awards** leaves old leads' breakdowns not adding up
  to their scores ("Changing a flow"). Accepted: it needs those two numbers to
  change, which has not happened.
- **"No" to `q3` has no answer of its own.** "Ready to move forward?" answered
  "no" or "not yet" is an unclear reply, and a second one sends the review text
  and the lead to Needs review. Left as it is: this lead did ask for
  information, so a person following up is not wrong the way it was on the
  offers question.
- **Lines drafted here, waiting for the client's word:** the reply to Special
  offers, the offers question's "sorry", the numbers on the offers question,
  and its third option, No thanks, with its reply.

## Decisions

| Decision | By | Date |
|---|---|---|
| Flows are rows in shared tables (ADR-001) - not columns with the script in code, nor a table per flow - done before the first real lead, while the tables were empty | Jeel | 2026-10-05 |
| The antibiotics script replaces health & wellness for new leads | Client | 2026-10-05 |
| Agents call everyone who finishes. "Order online" leads get the link and may still not finish alone; they are WARM, so they come after the leads who asked for a call | Jeel | 2026-10-05 |
| "I know which antibiotic" gets the link straight away. The first answer to it was a follow-up question ("order online, or a call from a rep?"), which led to the same two places as choices 2 and 3 | Client | 2026-10-05 |
| LEARN MORE, not INFO: EZ Texting keeps INFO for itself and answers it with the account's help text, so the lead would never get ours | Client | 2026-10-05 |
| The offers question takes 1, 2 and 3 as well as the words, so it is answered like every other question | Jeel | 2026-10-05 |
| "Learn more" is not HOT. That lead said No to the first question; above leads who said Yes it would push buyers down. They keep their 10 points, and the tag says why they are in the queue | Jeel | 2026-10-05 |
| The word "call" is not promised to a Learn more lead: "a representative will contact you" | Client | 2026-10-05 |
| Unclear replies repeat the options. The client's script had one "sorry" for every question, which did not say what to reply | Client | 2026-10-05 |
| "No thanks" is a third answer to the offers question. A lead who wanted neither offers nor a rep had only STOP to say so, which takes them off every list - and a frustrated lead types it. Typed anyway, "no" was an unclear reply, and a second "no" promised a representative and a place in the agents' queue: someone who had declined three times was promised a call. Now it is understood, thanked and left alone - out of the queue, Not interested on Admin > Leads, still subscribed | Jeel | 2026-10-06 |
| A question is named by its key, a sub-question after its parent (`q1-a`, `q1-b`); positions in tens, a sub-question behind its parent | Jeel | 2026-10-06 |

## History

- 2026-11-27 · Rewritten to the area template; the antibiotics flow moved here
  from `STATE-MACHINE.md`, checked word for word against migration 012; the
  tables' columns left to `SCHEMA.md`; the endings' screens linked to
  `QUEUE.md` and `ADMIN-LEADS.md`; the claim that the server's image holds
  `scripts/` corrected - since review H13 it holds only `dist/` and
  `scripts/migrate.js` (`backend/Dockerfile`); the rule for a first question
  from `SCHEMA.md` · `docs/DOCS.md` · D14, D24, D09
- 2026-11-27 · Several flows at once planned as Phase 8, a flow per bucket ·
  `BUCKETS.md`
- 2026-10-06 · The flow walked with a real phone, on the EZ Texting test
  account, replies through a temporary tunnel and its own subscription (removed
  afterwards), a fresh lead each walk. Yes, No, 2: completed, 90, HOT, queue
  "Yes · No · Talk to an agent". No, Learn more: completed, 10, in the queue as
  Wants a call. No, No: Not interested, out of the queue, not blocked. No, Yes:
  Offers, out of the queue. What, Huh: one "sorry", then the review text, Needs
  review, stuck at Q1. Yes, Yes as fast as the phone allowed: one answer saved,
  question 2 sent once, no question 3. Yea, Yes, 1: "Yea" got the "sorry" - so
  `yea` and `ya` were added to every Yes, and the offers question's Yes given
  the same list as the others - then completed, 85, HOT, with the link. Yea,
  Stop, Start: accepted, blocked and suppressed on Stop, released on Start, in
  the queue as Inbound reply. Not walked: a contact arriving through the poller
  (each lead was made by hand; that path was unchanged and proved in
  September), "Order online", and calls · Phase 5
- 2026-10-06 · What only the real phone showed: a text over 160 characters
  arrives as one message (the 243-character reply to No on `q2` joined with
  `q3`), so a reply and its question stay one text; EZ Texting passes "Learn
  more" through and sends nothing of its own, as it does not for INFO; two
  texts sent 1.2 seconds apart reached us 33 milliseconds apart - delivered
  together, exactly when the second used to be read as the next question's
  answer (`STATE-MACHINE.md`, rule 2c) · Phase 5
- 2026-10-06 · "No thanks" added to the offers question; questions named by
  key, the offers question `q1-a` at position 11 - it had its own name and sat
  fourth, and the screens said "Q4", "Stopped at Q4" for a lead who had
  answered one question · Jeel's decisions above
- 2026-10-05 · A lead who sent INFO got the account's own help text and never
  ours - found by texting it; the client chose "Learn more" · Phase 5
- 2026-10-05 · Flows as rows, migration 012 (ADR-001). Until then the app knew
  one script - three questions with three choices each, answers in three
  columns on `conversations`, texts in `settings`, points in `scoring_rules`.
  The client sent a new script (questions with two choices, a reply to each
  answer, a branch after No) and more groups are expected, each with its own
  questions and number of them: three columns cannot hold a five-question
  flow, and a second flow's "q1 = 1" would mean something else. Weighed: A,
  keep the columns and write the script into the code - 12-14 hours, one flow
  only, every later script change a developer's, the proper design then done
  on live data; B, one table per flow - each fits its flow, but the queue, the
  lead page, the admin pages and every report need new code per flow, and
  nothing lists across flows; C, rows in shared tables - about a week, once, a
  new flow is new rows, the standard design for surveys and forms. The trade
  was timing: A launched a week sooner and guaranteed C later, on live data; C
  cost that week while the tables were empty. C chosen, before the first real
  lead - afterwards every change to how answers are stored has to carry live
  data with it · Jeel · Phase 5, `feat/flows`
