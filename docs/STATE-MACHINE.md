# State machine

How a lead moves through the SMS qualification flow: what each reply does, what
gets sent, how it is scored, and when it stops. This file describes behaviour
only. What is built, and when, is the plan's job - CLAUDE.md §10.

**This document is the authority for the flow.** Where it differs from the
mockup PDF, this document wins. Decided by Jeel on 2026-09-19: the mockup is a
reference for screens and wording, not for flow logic, because it contradicts
itself in places (page 2 shows a STOP confirmation, page 3 says send nothing)
and leaves cases undefined. Decisions below that go beyond the plan are marked
**Decided** with the reason, so they can be revisited deliberately rather than
rediscovered.

Code: `backend/src/core/` for the pure logic, wired in from
`backend/src/api/webhooks.ts` (replies) and `backend/src/worker/` (opener,
expiry). Related: WEBHOOKS.md, POLLER.md, SCHEMA.md, the plan's §6.

## What is built, 2026-09-21

The pure core only:

| File | Holds |
|---|---|
| `core/state-machine.ts` | `step()` and `tierFor()` - every branch below, and scoring |
| `core/answers.ts` | `matchAnswer()` - the numbers and the word lists |
| `core/state-machine.test.ts` | 34 tests, one per case in "Tests the state machine needs" |

**Nothing calls it yet.** A real reply still lands in `messages` and stops
there: the webhook stores it without advancing the conversation, so a lead who
has answered still reads as Awaiting reply on Admin > Leads. Wiring it in is the
next piece, and until then these behaviours exist only in the tests.

Also still to come: the expiry sweep, `expires_at` on send, and the queue API.

Opt-out detection is deliberately **not** in `core`. `api/webhooks.ts` already
holds the keyword list and passes the outcome in as `reply.optOut`, so there is
one list rather than two that can drift.

---

## Shape of the code

The core is a pure function, no database and no network, so every branch below
is unit-testable:

```
step(conversation, reply, rules) -> { conversation', send: messageKey | null, blockNumber: boolean }
```

- `conversation` - the current row: status, step, q1-q3, invalid_count, score, tier.
- `reply` - the inbound text and the payload's `optOut` flag.
- `rules` - scoring rules, tiers and settings, loaded by the caller.
- `send` - which copy to send (`question_2`, `message_clarify_2`, ...), or null.
  The caller renders it with `core/messages.ts` and sends it.
- `blockNumber` - the caller adds the phone to `dnc_list`.

The webhook loads the lead's newest conversation, calls `step`, saves the
result, sends, and records the send - in that order, in one transaction except
the send itself (see "Sending").

Answer matching is a separate pure function the state machine calls:
`matchAnswer(text, step) -> 1 | 2 | 3 | null`.

---

## States

| Status | Meaning | Automated messages? |
|---|---|---|
| `open` | Waiting for the answer to question `step` (1-3) | Yes |
| `completed` | All three answered, scored and tiered | No |
| `review` | Too many unclear replies; a human takes over | No |
| `suppressed` | Opted out | Never |
| `expired` | Went quiet past the expiry window | No |

Only `open` is ever advanced. The other four are final for that conversation.
Today a number that comes back is skipped; the decided rules for restarting it
are under "A number that comes back", not built yet.

---

## What a reply does

Checked in this order. The first match wins.

### 1. Opt-out - any status

The reply is an opt-out if the payload's `optOut` is true, or the whole message
is one of STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT, REVOKE, OPTOUT (case and
trailing punctuation ignored). This is already implemented in the webhook.

- Add the phone to `dnc_list`, reason `sms_stop`.
- If the conversation is `open`, set it `suppressed`. Other statuses keep their
  status; the `dnc_list` row is what blocks contact.
- **Send nothing ourselves.** The lead must get exactly one unsubscribe
  confirmation, and EZ Texting sends it automatically. Verified 2026-09-19 by
  texting STOP from Jeel's phone; the reply was:

  > PillRx: You have opted out of this program & will no longer receive any
  > messages. Reply REPORT to report unwanted messaging. Text START to opt back
  > in.

  A confirmation from us as well would reach the lead as a second unsubscribe
  message. EZ Texting also marked the contact `optOut: true`. So
  `settings.message_stop` is never sent; it stays seeded only in case the
  account's own handling is ever switched off.

#### What STOP does, end to end

| Who | What happens |
|---|---|
| EZ Texting, automatically | Sends the unsubscribe confirmation and marks the contact `optOut` |
| Our app | Adds the phone number to `dnc_list` |
| Our app | If the conversation is `open`, sets it `suppressed` |
| Our app | Stores the STOP message on the lead, so the history shows it |
| Our app | Sends nothing |

The lead row stays. What is blocked is the **phone number**: `dnc_list` is keyed
on phone, so the block holds whatever lead or conversation the number later
belongs to. From then on:

- no automated text of any kind goes to that number;
- if the number is delivered again as a new lead, the poller saves it as
  suppressed and sends nothing;
- agents cannot call or text it, once calling and agent SMS exist, and the
  queue never shows a number that is on `dnc_list`, whatever its conversation
  status;
- Admin > Leads shows it as Opted out;
- START does not unblock it - see "Opting back in".

### 2. Conversation not `open`

`completed`, `review`, `expired` or `suppressed`: store the message, set
`leads.has_unread_inbound`, send nothing. A human sees it on the lead. Already
implemented.

### 3. A valid answer to the current question

`matchAnswer(text, step)` returns a choice. Accepted forms - the number, or at
most three words per option (decided 2026-09-17):

| | Option 1 | Option 2 | Option 3 |
|---|---|---|---|
| Q1 | 1, supplements, supplement | 2, telehealth, rx | 3, both |
| Q2 | 1, today | 2, this week, week | 3, researching |
| Q3 | 1, call, call me | 2, text, text me | 3, later |

Before matching, the reply is lowercased and trimmed, trailing punctuation is
dropped, and a leading `option` or `#` is stripped - so `1.`, `Option 1` and
`Supplements!` all match.

- **The whole message must be one of the accepted forms.** No matching inside a
  sentence, or "not today" would count as "today" and "I don't want
  supplements" as supplements.
- **Anything else is unclear** and goes to rule 4. That includes every sentence
  and anything ambiguous, such as "both today" - a human reads those.
- The word list is fixed in code. If the client wants to edit it, it moves to
  `settings` like the message copy.

On a valid answer:

- Save the choice to `q{step}`.
- Reset `invalid_count` to 0.
- Add points - see "Scoring".
- If `step` < 3: `step + 1`, send `question_{step+1}`.
- If `step` = 3: status `completed`, add the completion award, send
  `message_thanks`.

### 4. Anything else - an unclear reply

- If `invalid_count` < `settings.max_invalid_before_review` (seeded `1`):
  increment it and send `message_clarify_{step}`. The step does not change.
- Otherwise: status `review`, send `message_review`.

**One clarification per question - Decided by Jeel, 2026-09-19.** Each repeats
that question's options, so the lead is reminded what the numbers mean:

| Step | `settings` key | Text |
|---|---|---|
| 1 | `message_clarify_1` | Sorry, please reply with just a number: 1 Supplements, 2 Telehealth/Rx, or 3 Both. |
| 2 | `message_clarify_2` | Sorry, please reply with just a number: 1 Today, 2 This week, or 3 Just researching. |
| 3 | `message_clarify_3` | Sorry, please reply with just a number: 1 Call me now, 2 Text me, or 3 Contact me later. |

It says "just a number" although words are accepted too; asking for a number
keeps the next reply as simple as possible.

**Decided: the count is per question.** It resets to 0 on every valid answer. A
lead who fumbles question 1 and then answers it should not arrive at question 2
already one mistake from review.

An unclear reply still earns the "responded" points - see "Scoring".

---

## Scoring

Rules come from `scoring_rules`; tiers from `tiers`. Both are admin-editable, so
they are read when the reply is processed, never cached across replies.

| Award | Code | When |
|---|---|---|
| Responded | `responded` | Once, on the first inbound reply that is not an opt-out, valid or not |
| Answer | `q{n}_{choice}` | Each valid answer |
| Completed | `completed` | Once, on the valid answer to question 3 |

**Decided: score and tier are updated on every reply, not only on completion.**
A lead who answers question 1 and goes quiet is a real responder, and the queue
shows responders; with a score of 10 or more they carry a tier like everyone
else. The schema doc explains why this is what fills the LOW band - completed
conversations never score below 40.

The tier is the `tiers` row whose range contains the score. A score of 0, which
means no reply yet, has no tier.

A conversation that ends in `review` keeps whatever it scored, typically the 10
for responding, and so reads as LOW.

---

## Expiry

- Every automated send sets `expires_at = now + settings.expiry_days` (seeded 7).
- Each worker tick marks `open` conversations past `expires_at` as `expired`.
  Nothing is sent to the lead.
- A reply that arrives after expiry follows rule 2: stored, flagged, no reply.
- Only `open` conversations expire. A `completed` or `review` conversation is
  not waiting on the lead, so it never does.

**Expired leads leave the agents' queue - Decided by Jeel, 2026-09-19.** This
covers both kinds:

| Case | Queue |
|---|---|
| Never replied, then expired | Not shown - the queue only ever shows responders |
| Replied at least once, then went quiet and expired | Not shown either |

Both stay visible on Admin > Leads under Expired. "Stalled at Q1" and "Stalled
at Q2" therefore apply only to responders whose conversation is still `open`.

**An expired lead who texts again comes back - Decided by Jeel, 2026-09-19,
confirmed the same day.** This is the lead texting us themselves, which arrives
through the webhook. It is not the partner sending the same number again - that
is "A number that comes back", below.

A reply after expiry still gets no automated answer (rule 2), but it is not
left sitting unseen:

- the message is stored and `leads.has_unread_inbound` is set, as today;
- the lead reappears in the agents' queue with the **Inbound reply** tag, so an
  agent follows up by hand;
- the conversation stays `expired` - no questions restart;
- once an agent opens the lead, the flag clears and it leaves the queue again,
  unless it now has a callback or other reason to be there.

This applies whether or not the lead ever answered before: texting us is
interest either way. A number on `dnc_list` never comes back, whatever it
sends.

The poller does not set `expires_at` on the conversations it creates today. It
must, when it sends the opener. Conversations already created without one are
expired by the same tick once `created_at` is older than `expiry_days`.

---

## Sending

- **Every send checks `dnc_list` immediately before sending**, automated or
  not: the opener, every reply in the flow, and later an agent's manual SMS.
  `sendMessage` in `integrations/ezt-client.ts` does not check it today - the
  poller checks before creating a lead, which covers the opener, but a reply
  sent minutes after a STOP from another source would not be caught. The check
  belongs inside the send path, so no caller can forget it.
- Every automated send uses the copy in `settings`, rendered by
  `core/messages.ts` (`{first_name}`, one-segment limit), and is recorded in
  `messages` with the id EZ Texting returns - that id is what links the lead's
  next reply back to it.
- The database changes commit first, then the send happens. A failed send is
  logged and leaves the conversation where it is; it does not roll the answer
  back. The lead has answered, and losing that would be worse than a missing
  follow-up.

### When the opener is sent - Decided by Jeel, 2026-09-19

**Immediately.** The opener goes out in the same poll cycle that finds the lead,
at any hour - this is how it is built today, and it stays that way. There is no
sending-hours window.

A failed opener is not retried. POLLER.md records the gap.

---

## A number that comes back

This is the **partner delivering the same number again** through the API, so
the poller finds it in EZ Texting. It is not the lead texting us after their
conversation expired - that is handled under "Expiry".

**Not built.** Today the poller skips a phone it already holds: no new
conversation, no text. The rules below are decided and wait for a check on
whether a returning number can be detected at all - CLAUDE.md §10, "Future:
repeat leads".

When built: when the poller finds a contact whose phone is already in `leads`, it decides
from the number's block status and its **newest** conversation. Decided by
Jeel, 2026-09-19: a returning number starts fresh, except when it is mid-flow or
blocked.

| Situation | What happens |
|---|---|
| Phone on `dnc_list`, or the contact is `optOut` in EZ Texting | Nothing, ever. Added to `dnc_list` if it was not already |
| Newest conversation `open` - mid-flow | Nothing. Restarting would send question 1 to someone partway through |
| Newest conversation `completed`, `expired` or `review` | New conversation at step 1 on the same lead, opener sent |
| Newest conversation `suppressed` | Nothing, ever - the number opted out |

One person is always one lead row; each return is a new conversation on it.
The new conversation starts clean: step 1, no answers, `invalid_count` 0, score
0, no tier.

**The earlier conversation is kept exactly as it ended.** Its status -
`completed`, `expired` or `review` - its answers, score and tier are never
changed or deleted, and every message from it stays on the lead. The **newest**
conversation is the one that drives the flow, the queue and the status on
Admin > Leads; the earlier ones are history, and are what "Seen before" shows.

**The lead takes the new delivery's date and origin - Decided by Jeel,
2026-09-19.** On a return, `ezt_added_at`, `source`, `group_id` and
`group_name` are updated from the new contact, and name and email where the new
contact has them. So the lead's age counts from the day it came back, and it
reads as a fresh lead in the queue rather than one received months ago.

"Seen before" in the queue is computed: the lead has an earlier conversation.

**Depends on:** EZ Texting showing a re-delivered lead to the poller at all.
POLLER.md, "Returning leads", explains why that is unverified and how to check.

---

## Opting back in - Decided

If an opted-out number texts START or UNSTOP, nothing changes on our side. The
`dnc_list` row stays and the number is never messaged automatically again. EZ
Texting may re-subscribe the number on its platform, but our list is checked
before every send, so it still blocks. Taking a number off `dnc_list` is a
deliberate human action; the design brief keeps DNC deletion out of v1 for
compliance.

---

## Tests the state machine needs

All against the pure function, no database:

- The happy path: 3, 1, 1 (Both, Today, Call me now) → `completed`, score 100, HOT.
- Every scoring combination lands in the tier its score implies.
- A word answer ("supplements", "this week", "call me") and a near-miss number
  ("1.", "Option 2", "#3") each count as valid.
- A sentence containing a valid word ("not today") is unclear, not an answer.
- One unclear reply → clarification, same step. A second → `review`.
- Unclear on question 1, valid, then unclear on question 2 → clarification, not
  review, because the count reset.
- STOP at step 1, 2 and 3 → `suppressed`, number blocked, nothing sent.
- STOP after `completed` → number blocked, status stays `completed`.
- Any reply after `completed`, `review`, `expired` or `suppressed` → nothing
  sent, conversation unchanged.
- A lead who answers question 1 and stops scores 15, 20 or 25 depending on the choice, and is LOW.
- `responded` is awarded once only, however many replies arrive.
- A reply to an `expired` conversation → nothing sent, conversation stays
  `expired`, lead flagged unread so the queue shows it as Inbound reply.

Plus integration tests for the webhook wiring, in the style of
`backend/src/api/__tests__/webhooks.test.ts`.

---

## Open items

None.

**Parked:** EZ Texting's automatic STOP reply signs as "PillRx", the account's
brand, while our opener signs as "Secure Medical". Jeel: not needed now.
