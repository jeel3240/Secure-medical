# State machine

How a lead moves through the SMS qualification flow: what each reply does, what
gets sent, how it is scored, and when it stops. This is the build spec for
Week 2.

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
- `send` - which copy to send (`question_2`, `message_clarify`, ...), or null.
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

Only `open` is ever advanced. The other four are final for that conversation. A
new conversation can start later only through the repeat-lead rules below.

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

### 2. Conversation not `open`

`completed`, `review`, `expired` or `suppressed`: store the message, set
`leads.has_unread_inbound`, send nothing. A human sees it on the lead. Already
implemented.

### 3. A valid answer to the current question

`matchAnswer(text, step)` returns a choice. The accepted forms are the plan's §6
table: the number, or at most three words per option, whole message only, after
lowercasing, trimming, dropping trailing punctuation and a leading `option` or
`#`.

- Save the choice to `q{step}`.
- Reset `invalid_count` to 0.
- Add points - see "Scoring".
- If `step` < 3: `step + 1`, send `question_{step+1}`.
- If `step` = 3: status `completed`, add the completion award, send
  `message_thanks`.

### 4. Anything else - an unclear reply

- If `invalid_count` < `settings.max_invalid_before_review` (seeded `1`):
  increment it and send `message_clarify`. The step does not change.
- Otherwise: status `review`, send `message_review`.

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

The poller does not set `expires_at` on the conversations it creates today. It
must, when it sends the opener. Conversations already created without one are
expired by the same tick once `created_at` is older than `expiry_days`.

---

## Sending

- Every automated send uses the copy in `settings`, rendered by
  `core/messages.ts` (`{first_name}`, one-segment limit), and is recorded in
  `messages` with the id EZ Texting returns - that id is what links the lead's
  next reply back to it.
- The database changes commit first, then the send happens. A failed send is
  logged and leaves the conversation where it is; it does not roll the answer
  back. The lead has answered, and losing that would be worse than a missing
  follow-up.

### Sending hours - Decided, not in the original plan

The opener goes out the moment the poller finds a lead, so a lead delivered at
2 a.m. is texted at 2 a.m. US rules on marketing texts generally limit them to
8 a.m.-9 p.m. in the recipient's local time.

- **The opener is only sent inside 8:00-21:00 in the lead's local time**,
  worked out from the phone's area code. When the area code does not map to a
  single time zone, use the window that is legal everywhere in the continental
  US: 11:00-21:00 Eastern.
- Outside the window, the lead and conversation are created as now, and the
  opener waits. Each worker tick sends any opener that is due and inside its
  window.
- **Replies are exempt.** Questions 2 and 3, the clarification, the review
  message and the thanks go out immediately, because they answer a text the
  lead has just sent.

The same "opener due" check also fixes the gap POLLER.md records, where a failed
opener is never retried: a conversation that is `open` at step 1 with no
outbound message is an opener still owed. Retries are capped so a number that
always fails does not hit the API every minute - see "Schema changes".

---

## Repeat leads

The plan's Week 2 item 8 - a new lead row per delivery, linked by
`previous_lead_id` - is **superseded**. One person is one lead row, and a return
is a new conversation on it. POLLER.md has the full reasoning; the rules:

| Newest conversation for that phone | What happens |
|---|---|
| none - phone not in `leads` | Create lead and conversation, send opener |
| on `dnc_list`, or `suppressed` | Nothing, ever |
| `open` | Nothing. They are already mid-flow; restarting would re-send question 1 to someone partway through |
| `completed`, `expired` or `review` | New conversation at step 1, send opener |

**Blocked**, as POLLER.md records: it depends on whether a lead re-delivered by
the partner reappears in EZ Texting as a new contact with a new `createdAt`, or
only updates the existing one. If it only updates, the poller never sees it
again and none of this runs. That needs confirming with Jim before this part is
built.

`leads.previous_lead_id` is dropped in the migration that implements this.

---

## Opting back in - Decided

If an opted-out number texts START or UNSTOP, nothing changes on our side. The
`dnc_list` row stays and the number is never messaged automatically again. EZ
Texting may re-subscribe the number on its platform, but our list is checked
before every send, so it still blocks. Taking a number off `dnc_list` is a
deliberate human action; the design brief keeps DNC deletion out of v1 for
compliance.

---

## Schema changes this needs

In a new numbered migration once `001_init.sql` has run anywhere that matters,
or folded into 001 while it has not:

- `conversations.opener_attempts SMALLINT NOT NULL DEFAULT 0` - counts send
  attempts for question 1, so retries stop after 5.
- Drop `leads.previous_lead_id`, with the repeat-lead work.
- An area code to time zone lookup for sending hours. A static table in code is
  enough; it changes rarely.

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

Plus integration tests for the webhook wiring, in the style of
`backend/src/api/__tests__/webhooks.test.ts`.

---

## Open items

1. ~~Test one STOP on the account.~~ Done 2026-09-19: EZ Texting confirms on its
   own, so we send nothing. See rule 1.
4. **Brand name.** EZ Texting's automatic STOP reply signs as "PillRx", the
   brand configured on the account, while our opener signs as "Secure Medical".
   A lead would see two names from one number, and carriers expect one brand per
   campaign. The client decides which is right: change the account's brand, or
   change `question_1`.
2. **Confirm with Jim** how a re-delivered lead arrives. Blocks repeat leads.
3. **Client approval of copy.** `message_clarify` still says "reply with just a
   number", narrower than what is now accepted.
