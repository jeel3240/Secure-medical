# Flows: questions and answers as rows

Built 2026-10-05, migration `012_flows.sql`. A **flow** is the script a lead is
taken through by SMS: what it asks, the choices for each question, what we
reply, how many points each answer is worth, and where the lead goes next.

This doc is how flows are **stored** and how to **add one**. How a reply is
handled - opt-outs, unclear replies, scoring, expiry - is `STATE-MACHINE.md`,
which also shows the script new leads get today.

Code: `backend/src/db/flows.ts` (reads a flow, starts a conversation),
`core/state-machine.ts` (follows it), `api/reply-flow.ts` (saves the answer).
Proof: `scripts/flows-live-check.ts`.

## Why it was changed

Until 2026-10-05 the app knew one script: three questions with three choices
each. Answers were three columns on `conversations` (`q1`, `q2`, `q3`), the
texts were rows in `settings`, the points were `scoring_rules`.

The client then sent a new script - eDrugstore antibiotics: questions with two
choices, a reply to each answer, a branch after "No" - and more groups are
expected, each with its own questions and its own number of them. Three
columns cannot hold a five-question flow, and a second flow's "q1 = 1" would
mean something different from the first's.

It was changed **before the first real lead**. Afterwards, every change to how
answers are stored has to carry live data with it.

## The decision (ADR-001)

**Status:** accepted, Jeel, 2026-10-05.

| Option | Verdict |
|---|---|
| **A. Keep the columns, write the new script into the code** | Fastest (12-14 hours). One flow only; every later script change needs a developer; the move to a proper design then happens on live data |
| **B. One table per flow** | Each table fits its flow, but the queue, the lead page, the admin pages and every report need new code for every flow, and nothing can be listed across flows |
| **C. Rows in shared tables** - chosen | About a week, once. A new flow is new rows. The standard design for surveys and forms |

The trade was A against C, and it was about timing: A launched a week sooner
and guaranteed doing C later, on live data. C cost that week while the tables
were empty.

## The tables

The first three are the **guide** - small, written by a migration, the same for
every lead. The fourth holds the **real values**.

| Table | One row per | Holds |
|---|---|---|
| `flows` | flow | `key` (`antibiotics`), `name`, `ezt_group` (not read yet), `responded_points`, `completed_points`, `review_body` (sent after a second unclear reply), `is_active` |
| `flow_questions` | question | `flow_id`, `key` (`q1`, `q1-a`), `position`, `body` (the question), `clarify_body` (the "sorry, please reply..." text), `heading` (what the screens call it: "Next step") |
| `flow_choices` | choice | `flow_id` and `question_id`, `choice` (`1`), `label` ("Talk to an agent"), `words` (also accepted: `{agent,talk,call}`), `points`, `reply_body`, and where it leads: `next_question_id`, or an `ending` |
| `conversation_answers` | answer given | `conversation_id`, `lead_id`, the question (`question_id`, and its key, position and heading copied in), `choice`, and the `label` and `points` **as they were then** |

And `conversations` - still one row per lead, which says where the lead is
**now**: `flow_id`, `current_question_id`, `status`, `score`, `tier`, and
`end_outcome` once the flow has ended. `current_question_id` is the question
the lead is on, or - once the conversation has expired or gone to review - the
one they stopped at; it is empty once the questions are finished. `step` is
that question's position. `question_sent_at` is when the text the lead has to
answer actually went out; while it is empty a reply is not counted
(`STATE-MACHINE.md`, rule 2c).

Think of an exam: `conversations` is the cover sheet - who, which question
they are on, the total mark. `conversation_answers` is the answer sheet.

### Rules the database enforces

- **One flow is active** - the one new leads get (`flows_one_active`).
- **A choice either leads to a question or ends the flow**, never both and
  never neither (`flow_choices_next_or_end`).
- **A choice belongs to one flow, and can only lead to a question of that
  flow** (`flow_choices_next_in_flow`). That is why a choice carries `flow_id`
  as well as its question: the database can then hold both the question and
  the next question to it. Without it a choice could point into another flow
  and a lead would be sent a question that is not theirs.
- **A conversation is only ever on a question of its own flow**
  (`conversations_question_in_flow`).
- **A flow awards something for replying** (`responded_points > 0`, and no
  default). "Has replied" is read everywhere as "score above 0" - the queue,
  the lead card - so a flow that gave nothing for a reply would hide its own
  leads.
- **A question is answered once in a conversation** (unique on conversation
  and question).
- **A saved answer cannot be edited or deleted** - the same trigger as the
  activity log. It is a record of what someone said.

### What a choice's ending means

| `ending` | Means | Completion award | Agents' queue |
|---|---|---|---|
| `completed` | The questions are answered | Yes | Yes, by score |
| `offers` | Wants offers only | No | No - Admin > Leads shows **Offers** |
| `wants_contact` | Asked to hear from a rep | No | Yes, tagged **Wants a call** |
| `declined` | Wants neither offers nor a rep | No | No - Admin > Leads shows **Not interested** |

The two that are not for agents are one list in the code, `NOT_FOR_AGENTS`
(`core/state-machine.ts`), which the queue reads. A new ending is added in
three places: the two `CHECK`s in the migration, the `Ending` type, and - if
agents should not see it - that list.

### `position` is not "what comes next"

`position` is display order, and the lowest is the question a new lead is
sent. Where a lead goes after an answer is the choice's `next_question_id`.
That is what makes a branch possible: "Yes" on the first question skips its
sub-question and goes straight to the second.

### Naming a question, and sub-questions - Jeel, 2026-10-06

A question's `key` is its name, and the screens read it from there
(`core/questions.ts`, one rule for every screen):

| Key | Is | Shown as |
|---|---|---|
| `q1`, `q2`, `q3` | A question on the main line | Q1, Q2, Q3 |
| `q1-a`, `q1-b` | A **sub-question** of question 1: asked only after some answer to it | Q1-a, Q1-b |
| anything else | - | The question's `heading` |

The antibiotics flow's offers question is `q1-a`: only a lead who said No to
question 1 is asked it. It had its own name and sat fourth, and the screens
said "Q4" - "Stopped at Q4" for a lead who had answered one question.

**Positions go in tens** - 10, 20, 30 for the main line - **and a sub-question
sits behind its parent**: `q1-a` is 11, `q1-b` 12. So the questions list in
the order a lead can meet them - Q1, Q1-a, Q2, Q3 - a sub-question that leads
back into the main line still leads forward, and one added later needs no
other row renumbered.

A flow may have as many sub-questions as it needs, under any question. A
sub-question of a sub-question has no name in this scheme; give it the next
letter under the same parent.

**A choice may only lead forward** - to a question with a higher `position`.
So a flow cannot loop, a question is asked once, and a lead's score is the sum
of its answers. The database cannot check this one; the state machine does,
and sends a lead who meets such a row to a person instead of asking again
(`STATE-MACHINE.md`, rule 3).

## How a reply moves a lead

1. The lead's conversation says which flow, and which question they are on.
2. The reply is matched against that question's choices: the number, or one of
   the choice's words.
3. The matching choice gives the label, the points, the reply text and the
   next question.
4. One row is written to `conversation_answers`; the conversation moves to the
   next question, or ends.

No match is an unclear reply. The system never looks for an empty column or
counts questions: it follows `next_question_id` until a choice has an `ending`.
A flow with two questions and one with five are the same code.

## Adding a flow

A flow is added by a **migration that only inserts rows**. No table, no column,
no code.

1. Insert the flow into `flows`, with `is_active = false`.
2. Insert its questions into `flow_questions`: keys `q1`, `q2`... and `q1-a`
   for a sub-question; positions in tens, a sub-question behind its parent
   ("Naming a question", above).
3. Insert each question's choices into `flow_choices`, with the flow's id and
   `next_question_id` or an `ending`.
4. To make it the one new leads get: set the old flow's `is_active` to false
   and the new one's to true, in the same migration.

`012_flows.sql`, section 5, is the pattern to copy. `scripts/flows-live-check.ts`
does exactly this with a throwaway five-question flow that has a branch, and
walks leads through it.

Check before shipping one:

- Every text against the 160-character segment limit. A choice's reply and the
  next question go out as one text; Admin > Configuration shows each as sent,
  with its segment count.
- The first question says who is texting and how to opt out.
- **Reply words are not reserved by EZ Texting.** STOP, HELP and INFO are
  answered by EZ Texting itself and never reach us - found with INFO on
  2026-10-05. Text a new keyword to the account before using it.
- The points against the tier bands (`tiers`): HOT starts at 75. **The most a
  lead can score must not pass 100** - the bands end there, the screens say
  "/ 100", and a score above it has no tier.
- Every choice leads forward, to a later `position`.

## Changing a flow

Also a migration. Leads already partway through are affected the moment it
runs, so:

- **Rewording** a question, a reply or a label is safe. Saved answers keep the
  label they had.
- **Changing points** changes what the next answer earns. Saved answers keep
  theirs, and a finished lead's score does not move.
- **Changing a flow's two awards** - for replying, for finishing - is the one
  change that shows on old leads: their score stays, but the breakdown's
  "Responded" and "Completed" lines are read from the flow as it is now, so
  the lines stop adding up to the score. An answer's line is unaffected.
  Accepted: it needs those two numbers to change, which has not happened.
- **Removing a question** that a conversation is on, or that anyone has
  answered, is refused by the database (foreign keys). Add a new flow instead
  and make it active; leads in the old one finish there.
- **Removing a choice** is not refused, and loses nothing already said: an
  answer carries its own copy of the label and the points. Leads still on that
  question can no longer pick it.

A lead stays in the flow it started in. Making another flow active changes
what **new** leads get.

## What is retired, and kept

Nothing was deleted. These stay in the database and are no longer read:

| Where | What |
|---|---|
| `conversations` | `q1`, `q2`, `q3` and `q1_label`, `q2_label`, `q3_label` |
| `settings` | `question_1..3`, `message_clarify_1..3`, `message_thanks`, `message_review` |
| `scoring_rules` | the whole table |

The health & wellness flow they described was copied into the new tables as
the inactive flow `wellness`, and every answer already given was copied into
`conversation_answers` under it.

## What this does not cover

- **Editing a flow from the website.** A flow is changed by a migration, with
  a PR and a review - CLAUDE.md §10's rule for scoring and copy still stands.
  The tables are what such a screen would edit; it is a later phase.
- **Several flows at once.** One flow is active. `flows.ezt_group` is there to
  give each EZ Texting group its own flow; the poller does not read it yet.
- **A question that is not a choice** - a date, a free-text answer. Every
  question is a list of choices.
- **The maximum score** on Admin > Configuration is the awards plus the best
  answer to each question. With a branch a lead cannot reach every question,
  so for some flows it will read higher than any lead can score. For
  antibiotics it is exact.
- **Rescoring.** Nothing rescores old leads when points change.

## Testing

| What | Where |
|---|---|
| Every branch of the antibiotics flow, every rule, and a five-question flow on the same code | `src/core/state-machine.test.ts`, `src/core/answers.test.ts` |
| The webhook walking the flow: the answer row, the joined text | `src/api/__tests__/webhooks.test.ts` |
| A second flow added as rows only, with a branch; a lead staying in its own flow; what the migration seeded | `scripts/flows-live-check.ts` |
| A saved answer keeping its label and points after the flow changes; that it cannot be edited | `scripts/lead-detail-live-check.ts` |
| The queue: offers leads out, Wants a call tagged, a row's answers | `scripts/queue-live-check.ts` |
| Admin > Leads' Offers status; Configuration reading the active flow | `scripts/admin-leads-live-check.ts`, `scripts/admin-live-check.ts` |

`backend/scripts/live-checks.sh` runs every live check on its own scratch
database.

### Testing a flow with one phone

A real walk needs a real phone, and every path of a flow is several walks. The
poller skips a number it already holds - repeat leads are not built,
`POLLER.md` - so a second walk would need a second phone or an emptied
database. For local testing there is a command instead:

```bash
docker compose exec api npm run dev:ask-again -- +16025550123
```

It marks the lead's open conversation expired, if it has one, starts a new one
in the flow new leads get, and sends the first question the way the poller
does. Nothing is deleted: the earlier walks and their answers stay on the lead.

- **Local only.** It refuses when `NODE_ENV` is `production`. That check is
  the only thing stopping it there: the file is not compiled into `dist/`, but
  the server's image does contain `scripts/`.
- It needs the lead to exist already - the first walk comes in through the
  poller - and refuses a blocked number: after a walk that ends with STOP, text
  START from the phone first.
- **The lead keeps its agent history.** A lead somebody holds, closed or left a
  note on still reads Working or Closed on Admin > Leads and in the queue
  whatever the new walk does. For the tags and statuses of an untouched lead,
  use a lead nobody has worked.
- Replies reach a local API only through a tunnel and its own EZ Texting
  subscription - `WEBHOOKS.md`, "Testing". Delete the subscription afterwards.

