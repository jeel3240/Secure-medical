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

**The script itself is data, since 2026-10-05.** This document has two parts:
the rules every flow follows - opt-out, unclear replies, scoring, expiry - and
the script new leads get today, **"The antibiotics flow"** just below. How
flows are stored, and how a new one is added, is `FLOWS.md`.

Code: `backend/src/core/` for the pure logic, wired in from
`backend/src/api/webhooks.ts` (replies) and `backend/src/worker/` (opener,
expiry). Related: WEBHOOKS.md, POLLER.md, SCHEMA.md, the plan's §6.

## The antibiotics flow - the script new leads get

eDrugstore antibiotics, the client's script, confirmed by email 2026-10-05. It
replaced the health & wellness questions before the first real lead. Stored as
rows (`flows.key = 'antibiotics'`, migration 012); this is it as a lead meets
it. A choice's reply and the question after it go out as **one text**.

```
q1  eDrugstore: Hi {first_name}, did you recently request more info about
    ordering antibiotics online? Reply 1. Yes, 2. No. Reply STOP to opt out.
      1 Yes  +20  "Great! Let's get you started."                        -> q2
      2 No    +0  "No problem."                                          -> offers

q2  Have you used telemedicine to get prescription medication before?
    Reply 1. Yes, 2. No.
      1 Yes  +15  "Great. eDrugstore makes the online consultation process simple."   -> q3
      2 No    +5  "No problem. You can complete your information online and,
                   when required, consult with a licensed healthcare provider."  -> q3

q3  Ready to move forward? Reply 1. I know which antibiotic I need,
    2. Talk to an agent for options & discounts, 3. Order online.
      1 I know which antibiotic  +30  "Great. Start your online consultation here:
                                       https://www.edrugstore.com/anti-ez"        ends: completed
      2 Talk to an agent         +45  "Thanks! An eDrugstore representative will contact you
                                       to discuss available options, pricing and discounts."  ends: completed
      3 Order online             +10  "Great! Start your online order and consultation here:
                                       https://www.edrugstore.com/anti-ez"        ends: completed

offers  Would you like to receive special offers from eDrugstore? Reply 1. Yes
        for offers, 2. Learn more from a rep, 3. No thanks, or STOP to unsubscribe.
      1 Special offers  +0  "Thanks! You'll receive special offers from eDrugstore.
                             Reply STOP to opt out."                      ends: offers
      2 Learn more      +0  "Thanks! An eDrugstore representative will
                             contact you shortly."                        ends: wants_contact
      3 No thanks       +0  "No problem. Thanks for your time."           ends: declined
```

Replying at all: +10, once. Finishing the three questions (an ending of
`completed`): +10. Tiers are unchanged: HOT 75-100, WARM 45-74, LOW 1-44.

| Path | Score | Tier | Then |
|---|---|---|---|
| Yes, Yes, Talk to an agent | 100 | HOT | Agents call, first |
| Yes, No, Talk to an agent | 90 | HOT | |
| Yes, Yes, I know which | 85 | HOT | Gets the link, and a call |
| Yes, No, I know which | 75 | HOT | The lowest HOT - one point less is WARM |
| Yes, Yes, Order online | 65 | WARM | Gets the link, and a call after the HOT ones |
| Yes, No, Order online | 55 | WARM | |
| No, then Special offers | 10 | LOW | **Not in the agents' queue** - marked Offers on Admin > Leads |
| No, then Learn more | 10 | LOW | In the queue, tagged **Wants a call** |
| No, then No thanks | 10 | LOW | **Not in the agents' queue** - marked Not interested on Admin > Leads |

**Decisions in it, and whose:**

- **"No thanks" is a third answer to the offers question** - Jeel, 2026-10-06.
  A lead who wanted neither offers nor a rep had only STOP to say so, which
  takes them off every list - and a frustrated lead types it. Typed anyway,
  "no" was an unclear reply: "Sorry, please reply 1 for offers, 2 to learn
  more...", and a second "no" got "a representative will follow up with you
  directly" and a place in the agents' queue. Someone who had declined three
  times was promised a call. Now it is understood, thanked, and left alone:
  out of the queue, Not interested on Admin > Leads, still subscribed. With
  the option printed the text is 158 characters - one segment.

- **Agents call everyone who finishes** - Jeel. "Order online" leads get the
  link and may still not finish alone; they are WARM, so they come after the
  leads who asked for a call.
- **"I know which antibiotic" gets the link straight away** - the client. Its
  first answer was a follow-up question ("order online, or a call from a
  rep?"), which led to the same two places as choices 2 and 3.
- **LEARN MORE, not INFO** - the client's script said "reply INFO". EZ Texting
  keeps INFO for itself: it answers with the account's help text and the lead
  never gets ours (found by texting it, 2026-10-05). The client chose "Learn
  more" instead.
- **The offers step takes 1 and 2 as well as the words** - Jeel, so it is
  answered like every other question.
- **"Learn more" is not HOT** - Jeel. That lead said No to the first question;
  putting them above leads who said Yes would push buyers down. They keep
  their 10 points, and the tag says why they are in the queue.
- **The word "call" is not promised** to a Learn more lead - the client: "a
  representative will contact you".
- **Unclear replies repeat the options** - the client agreed; its script had
  one "sorry" for every question, which did not say what to reply.

**Accepted replies.** The number, or one of the choice's words, as the whole
reply, any case:

| | Choice 1 | Choice 2 | Choice 3 |
|---|---|---|---|
| q1 | 1, yes, y, yeah, yep, yup, yes please, sure, ok, okay, correct | 2, no, n, nope, nah, no thanks, no thank you | - |
| q2 | 1, yes, y, yeah, yep, yup, yes please, i have | 2, no, n, nope, nah, never, not yet | - |
| q3 | 1, i know, know, i know which one | 2, agent, talk, call, call me, talk to an agent | 3, online, order, order online |
| offers | 1, yes, y, yes please, offers, offer | 2, learn more, learn, more, learnmore | 3, no, n, nope, nah, no thanks, no thank you, not interested |

**The unclear-reply texts:**

| Question | Text |
|---|---|
| q1, q2 | Sorry, please reply 1 for Yes or 2 for No. |
| q3 | Sorry, please reply 1. I know which antibiotic I need, 2. Talk to an agent, or 3. Order online. |
| offers | Sorry, please reply 1 for offers, 2 to learn more from a rep, 3 for no thanks, or STOP to unsubscribe. |
| second unclear reply, any question | Thanks! An eDrugstore representative will follow up with you directly. |

**Drafted here, not in the client's script** - to be confirmed in its test
run: the reply to Special offers, the offers "sorry", the numbers on the
offers question, and its third option, No thanks, with its reply.

**Two texts run past 160 characters** and are billed as two segments: the
replies to q2 joined with q3 (189 and 243 characters). One text was kept
anyway, so a reply and its question cannot arrive out of order. Admin >
Configuration shows each text and its segment count.

## What is built

| File | Holds |
|---|---|
| `core/state-machine.ts` | `step()`, `tierFor()`, `firstQuestion()` - every rule below, for any flow |
| `core/answers.ts` | `matchChoice()` - a reply against one question's choices |
| `db/flows.ts` | Reads a flow; starts a conversation in the active one |
| `api/reply-flow.ts` | Loads the conversation and its flow, runs `step`, saves the answer row, sends |
| `core/state-machine.test.ts`, `core/answers.test.ts` | 63 tests: every branch of the antibiotics flow, every rule below, and a five-question flow run on the same code |
| `api/__tests__/webhooks.test.ts` | 44, including the flow advancing through the webhook and flagging a reply for a person |
| `scripts/flows-live-check.ts` | Against a real Postgres: a second flow added as rows only, walked end to end |

The first flow - health & wellness, three questions with three choices each -
was verified against the live account on 2026-09-21. It is kept, inactive, as
the flow `wellness`.

Two things deliberately not where the spec's sketch might suggest:

**Opt-out detection stays in `api/webhooks.ts`,** which already held the keyword
list. The core is told the outcome via `reply.optOut`, so there is one list
rather than two that drift. `blockNumber` on the result is what drives the
`dnc_list` write, so the rule itself lives in the core.

**The send is a closure, not part of `applyReply`.** `applyReply` returns
`{ result, send }`: the caller commits the transaction, then calls `send()`.
That order is the spec's - a failed send must not roll back an answer the lead
has already given - and making it two steps means the caller cannot get it
wrong by accident.

---

## Shape of the code

The core is a pure function, no database and no network, so every branch below
is unit-testable:

```
step(conversation, reply, rules) -> { conversation', send: string[], blockNumber, needsPerson, answer }
```

- `conversation` - the current row: status, the question the lead is on
  (`current_question_id`, with `step` as its number for the screens),
  invalid_count, score, tier, end_outcome.
- `reply` - the inbound text and the payload's `optOut` flag.
- `rules` - the conversation's flow, the tiers and settings, loaded by the
  caller.
- `send` - the texts to send, in order, as **one** SMS: a choice's reply and
  then the next question, or a clarification alone. Empty when nothing is
  sent. The caller fills in `{first_name}` (`core/messages.ts`) and sends it.
- `blockNumber` - the caller adds the phone to `dnc_list`.
- `needsPerson` - sets `has_unread_inbound`: "Which replies need a person",
  below.
- `answer` - the answer this reply gave, for the caller to write to
  `conversation_answers`; null when it gave none.

The webhook loads the lead's newest conversation, calls `step`, saves the
result, sends, and records the send - in that order, in one transaction except
the send itself (see "Sending").

**The conversation row is locked while that happens** (`FOR UPDATE`, added
2026-09-22). Two texts sent moments apart arrive as two requests at once;
without the lock both could read the same step, treat their text as the answer
to it, and each send the next question - the lead gets it twice and one answer
is lost. The lock holds one lead's row, so replies from other leads are handled
in parallel: verified by holding one conversation for six seconds, during which
that lead's reply waited and four other leads' replies completed in 0.2s each.

Answer matching is a separate pure function the state machine calls:
`matchChoice(text, choices)` - the choice of the current question the reply
names, or null.

---

## States

| Status | Meaning | Automated questions? |
|---|---|---|
| `open` | Waiting for the answer to the question the lead is on | Yes |
| `completed` | The flow ended on a choice. `end_outcome` says how: `completed` (the questions are answered), `offers`, `wants_contact`, or `declined` | No |
| `review` | Too many unclear replies; a human takes over | No |
| `suppressed` | Opted out | Never |
| `expired` | Went quiet past the expiry window | No |

Only `open` is ever advanced. The other four are final for that conversation.

*(2026-10-01: the column says questions, not messages, because one automated
text now sits outside this flow - "The missed-call text", below.)*
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
- agents cannot call or text it, and the
  queue never shows a number that is on `dnc_list`, whatever its conversation
  status;
- Admin > Leads shows it as Opted out;
- START does not unblock it - see "Opting back in".

### 2. Conversation not `open`

`completed`, `review`, `expired` or `suppressed`: store the message, set
`leads.has_unread_inbound`, send nothing. A human sees it on the lead. Already
implemented.

### Which replies need a person - Decided by Jeel, 2026-09-28

`leads.has_unread_inbound` means *a person has to read this*, and it is set only
when the questions cannot handle a reply: rule 2 above, and rule 2b below - a
message to an agent who took the conversation over. `step()` returns this as
`needsPerson`, so the rule lives beside the others; a lead with no conversation
at all is flagged too, since nothing handles their message either.

Never flagged: a valid answer, an unclear reply (the clarification, or the move
to review, is the response - and `review` is how that lead reaches a person),
and an opt-out.

**Why.** The flag is the queue's *Inbound reply*, and it decides who is in the
queue. It used to be set on every reply, so a lead simply answering "1" read as
an inbound reply - every responder did. Migration 003 (part 2) cleared the flags that
rule left behind: `SCHEMA.md`.

### 2b. An agent has taken the conversation over - Decided by Jeel, 2026-09-23

Once an agent sends a manual SMS to a lead, the questions stop. The reply is
stored and `leads.has_unread_inbound` is set, exactly as in rule 2, and the
agent reads it on the lead. Nothing is scored, no question and no clarification
goes out.

**Why.** The agent is having a conversation with the lead. A lead who has just
been asked "when is a good time to call?" and answers "1" is answering the
agent, not us, and an automated "Question 2 of 3" landing on top of that reads
as a broken system to the person we are trying to sell to. Losing the score
matters little, because a lead an agent is already working is not waiting in the
queue to be picked.

**Opt-out and opt-in are not affected.** Rule 1 is checked first and stays
first: a STOP after the handoff blocks the number, and a START releases it. An
opt-out can never depend on whether an agent happened to text first.

The lead keeps the score it had earned. A lead who answered question 1 and was
then taken over stays at that score and its tier, rather than reaching the
completion award.

**How it is recorded:** a timestamp on the conversation, set when the first
agent SMS is sent. The status does not change, so the queue tabs and Admin >
Leads are unaffected, and expiry still applies - the agent's own callback and
disposition are what track the lead from then on.

**Built 2026-09-26** (Phase 3 task 9). `conversations.agent_took_over_at` is set
by `POST /api/leads/:id/messages` - `db/agent-sms.ts` - and read by
`api/reply-flow.ts`, which passes it to the state machine as `agentTookOverAt`.
The rule sits between the not-open check and answer matching, so an opt-out is
still decided first.

The timestamp is set only on the first agent message, by `COALESCE`: the handoff
happened then, and the tenth message should not rewrite when it happened. It is
set only while the newest conversation is still `open` - texting a lead whose
conversation already completed is not taking over a flow that is still running.

A send that fails, or is refused because the number is on `dnc_list`, records no
take-over: the questions must not stop on the strength of a message the lead
never received. `scripts/agent-sms-live-check.ts` proves that, and proves a real
reply after the handoff gets no question, no score and no clarification.

### 3. A valid answer to the current question

`matchChoice` returns one of the current question's choices. Accepted, as the
whole reply:

| Form | Examples |
|---|---|
| The choice's number | `2`, `2.`, `(2)`, `Option 2` |
| One of its words - the lists are with the flow, above (`flow_choices.words`) | `no`, `Nope.`, `yes 👍` |
| Its name, as the screens show it (`flow_choices.label`) | `Talk to an agent` |
| The option as it was printed: the number, then text beginning with a word or the name of that same choice | `1. Yes`, `2) Talk to an agent for options & discounts` |

Before matching, the reply is lowercased and everything that is not a letter
or a digit becomes a space - so punctuation, brackets and emoji never decide
the outcome - and a leading `option` is dropped.

*(2026-10-06, from review: until then only trailing `.!?,;:` was dropped, so a
lead who typed the option the way the question printed it - "1. Yes" - or
"No, thanks", or added an emoji, was told "Sorry, please reply 1 for Yes or 2
for No", and sent to a person on the second try. "yes please" and "no thank
you" were added to the words the same day.)*

- **Only the choices that question has.** Question 1 has two: `3` is not an
  answer to it.
- **The whole message must be one of the accepted forms.** No matching inside a
  sentence, or "no, I want to talk to someone first" would count as No, and "I
  don't know which one" as "know".
- **Anything else is unclear** and goes to rule 4 - every sentence, and
  anything ambiguous. A human reads those. `1 no` names two choices, so it is
  neither.
- **A message over 80 characters is never an answer**, and is not examined:
  an answer is a number or a few words.
- **The same word can mean different things on different questions.** "yes" is
  an answer to q1, q2 and the offers question; "call" only to q3.

On a valid answer:

- Write one row to `conversation_answers`: the question, the choice, and the
  choice's label and points as they are at that moment.
- Reset `invalid_count` to 0.
- Add the choice's points - see "Scoring".
- **If the choice names a next question:** move the lead to it, and send the
  choice's reply and that question as one text.
- **If the choice ends the flow:** status `completed`, `end_outcome` from the
  choice, the completion award if that outcome is `completed`, and send the
  choice's reply.
- **If the choice names a question the flow cannot go to** - one it does not
  have, or one at or before the current question, which would ask it again and
  score it twice - the rows are wrong, not the lead: the answer is kept,
  status becomes `review`, and the flow's review text is sent. No completion
  award. The database refuses most such rows (`FLOWS.md`, "Rules the database
  enforces"); this is for what it cannot (2026-10-06 - before, such a lead was
  quietly marked completed).

### 4. Anything else - an unclear reply

- If `invalid_count` < `settings.max_invalid_before_review` (seeded `1`):
  increment it and send the question's own clarification
  (`flow_questions.clarify_body`). The lead stays on that question.
- Otherwise: status `review`, send the flow's review text. The conversation
  stays on the question the lead could not answer, so the screens can say
  where they got stuck.

**One clarification per question - Decided by Jeel, 2026-09-19.** Each repeats
that question's options, so the lead is reminded what the numbers mean. The
texts are with the flow, above.

**Decided: the count is per question.** It resets to 0 on every valid answer. A
lead who fumbles question 1 and then answers it should not arrive at question 2
already one mistake from review.

An unclear reply still earns the "responded" points - see "Scoring".

---

## An answer keeps what it was

An answer is its own row in `conversation_answers`, written once when the
reply is accepted, and never changed - the table refuses edits. The row holds
the choice's **label and points as they were at that moment**.

**Why.** The client renames choices, adds new ones and changes points. A lead
who chose "Supplements" last week must still read "Supplements" after choice 1
is called something else, and their score breakdown must still add up after
the points change. Once a flow changes there is no way to recover what an
earlier lead was offered, so it is kept from the start. (Migration 009 did
this for the label, in columns; migration 012 moved it to rows and added the
points.)

- **What the screens show**: the saved label and points - on the queue, the
  lead card and its breakdown, the incoming-call card and the conversation.
- **Changing a flow** changes what the next lead gets, never what an earlier
  one has. `scripts/lead-detail-live-check.ts` renames a choice and re-scores
  it, and checks both leads.

## Scoring

Points come from the flow - each choice's `points`, and the flow's
`responded_points` and `completed_points`; tiers from `tiers`. All are read
when the reply is processed, never cached across replies, so a change made by
a migration takes effect on the next reply.

| Award | When |
|---|---|
| Responded | Once, on the first inbound reply that is not an opt-out, valid or not |
| Answer | Each valid answer: that choice's points |
| Completed | Once, when the flow ends with the outcome `completed` - not on the offers branch |

**Decided: score and tier are updated on every reply, not only on completion.**
A lead who answers question 1 and goes quiet is a real responder, and the queue
shows responders; with a score of 10 or more they carry a tier like everyone
else. *(2026-09-28: the queue no longer shows a lead partway through - only
completed, needs review, an inbound reply, or one being worked - `QUEUE.md`. A
partway lead still carries its running score and tier, on Admin > Leads.)* The schema doc explains why this is what fills the LOW band - completed
conversations never score below 40.

The tier is the `tiers` row whose range contains the score. A score of 0, which
means no reply yet, has no tier.

A conversation that ends in `review` keeps whatever it scored, typically the 10
for responding, and so reads as LOW.

---

## Expiry

- A send of the opener or of a message in this flow that **succeeds** sets
  `expires_at = now + settings.expiry_days` (seeded 7). An agent's own text and
  the missed-call text do not move it. A send that fails leaves it where it was, so a lead who was never
  actually messaged expires on schedule rather than a week late.
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

Both stay visible on Admin > Leads under Expired. *(2026-09-28: there is no
longer a "Stalled at Q1 / Q2" tag - a lead partway through is not in the queue
at all.)*
Which leads the queue shows and the tag each gets is in `QUEUE.md`.

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
  unless it now has a callback or other reason to be there. *(2026-09-28:
  once an agent **picks** it, not opens it - looking at a lead no longer clears
  the flag. `AGENT-WORKSPACE.md`, "Rules".)*

*(2026-09-22: the last bullet is not built. `api/webhooks.ts` sets
`has_unread_inbound` and nothing anywhere unsets it, so such a lead stays in
the queue tagged Inbound reply instead of leaving it. Opening a lead is the
agent workspace, Week 3 - that is where the clear belongs.)* *(Built in Phase
3: `db/read-flag.ts`, when the holder opens the lead, and saving an outcome
clears it too.)*

This applies whether or not the lead ever answered before: texting us is
interest either way. A number on `dnc_list` never comes back, whatever it
sends.

**Built 2026-09-22.** `worker/expiry.ts` runs on every worker tick, after the
poll and in its own try/catch: expiring is local work that must keep happening
while EZ Texting is unreachable.

`expires_at` is set once a message has actually gone out, not when the
conversation is created and not when a send is merely attempted - by
`sendOpener` in `worker/opener.ts` (the poller and the opener retry) and by `bumpExpiry` in `reply-flow.ts`, both after
the send returns. It is the window the lead has to reply to *that message*, so
a conversation whose opener or follow-up failed has not started one. Those, and
any created before this existed, fall back to `created_at + expiry_days` in the
sweep, which is what stops them sitting `open` forever.

*(Corrected 2026-09-22: the flow used to move the deadline as soon as it decided
to send, so a failed message still bought the lead another week. The two paths
now behave the same.)*

The sweep is idempotent - a second run in the same minute expires nothing - and
verified against the database: of seven conversations, the two overdue `open`
ones expired (including one with no `expires_at`), the future-dated and
freshly-created `open` ones did not, and `completed`, `review` and `suppressed`
were untouched despite all being overdue. A reply to an expired conversation
left it `expired`, set `has_unread_inbound`, and sent nothing.

---

## Sending

- **Every send checks `dnc_list` immediately before sending**, automated or
  not: the opener, every reply in the flow, an agent's manual SMS, and the
  missed-call text.
  Built 2026-09-21: `sendMessage` in `integrations/ezt-client.ts` queries
  `dnc_list` and throws `BlockedNumberError` before calling the API, so no
  caller can forget. A bare number is normalised to E.164 first - comparing
  `16026203572` against a stored `+16026203572` would match nothing and send to
  a blocked phone.
  The conversation still advances when a send is refused: the lead's answer is
  recorded, and only the message is withheld. Its `conversation.advanced` log
  line says `"sent": false`, so the case is visible.
- Every automated send is rendered by `core/messages.ts` (`{first_name}`) and
  recorded in `messages` with the id EZ Texting returns - that id is what links
  the lead's next reply back to it. The questions and replies come from the
  lead's flow and are sent whole, however long: a reply and its question are
  one text. The first question and the missed-call text keep the one-segment
  limit, dropping the name if it would not fit.
- **A lead whose text did not go out is flagged for a person** - 2026-10-06,
  from review. They answered and heard nothing back, the conversation is on a
  question they never received, and nothing retries it; partway through the
  questions they are not in the queue either, so they would have sat unseen
  until they expired - every lead who replied during an EZ Texting outage.
  The reply flow now sets `has_unread_inbound`, which puts them in the queue
  as an inbound reply, with the failed text in the thread. Not for a blocked
  number.
- **A send that timed out is not treated as refused** - calls to EZ Texting
  give up after 30 seconds, and a text cut off that way may still have gone
  out. Its row stays `sending`, so it is never sent a second time;
  `db/outbound.ts`.
- The database changes commit first, then the send happens. A failed send is
  logged and leaves the conversation where it is; it does not roll the answer
  back. The lead has answered, and losing that would be worse than a missing
  follow-up.
- **Every automated send is recorded around the send** - `db/outbound.ts`,
  2026-09-28. The row is written as `sending` first, so if the database is
  down nothing is sent; EZ Texting's id is recorded after, and if that write
  fails the text went out, so the row stays `sending` rather than being marked
  refused and sent again.
- **A message EZ Texting refuses is kept, marked failed** - 2026-09-28,
  `db/outbound.ts` (an agent's own SMS: `db/failed-sends.ts`). It has `delivery_status = 'failed'` and no
  `ezt_message_id`, so no reply can link to it, and it does not restart the
  reply window. The thread shows it with a red "!". A send refused because the
  number is blocked is not kept: it was never attempted.

### When the opener is sent - Decided by Jeel, 2026-09-19

**Immediately.** The opener goes out in the same poll cycle that finds the lead,
at any hour - this is how it is built today, and it stays that way. There is no
sending-hours window.

A failed opener is retried - up to four times over about nine hours, and never
more than 24 hours after the lead arrived (2026-09-28). POLLER.md, "Retrying a
failed opener".

---

## The missed-call text

Added 2026-10-01 with incoming calls - `TWILIO.md`, "A missed call". It is the
one automated text that is not part of this flow, so its rules are stated here
once:

- **When.** A lead rings our number and nobody answers. `message_missed_call`
  from `settings` is sent, once per call (`db/missed-call-text.ts`).
- **To whom.** Any lead, whatever their conversation's status - `open`,
  `completed`, `review`, `expired`, or `suppressed` with the block since
  released. Only a live `dnc_list` row stops it, through the same check every
  send makes.
- **It changes nothing in the conversation.** It is recorded like any automated
  text (`sent_by` null). It does not advance a step, does not take the
  conversation over, and does not move `expires_at`.
- **A reply to it is an ordinary reply**, handled by the rules above:
  - conversation ended - stored and flagged for a person (rule 2). This is the
    usual case and the right outcome: "ok, call me after 5" reaches an agent;
  - conversation taken over by an agent - stored and flagged (rule 2b);
  - conversation still `open` - **read as an answer to the current question.**
    "ok thanks" gets the clarification, and a second such reply sends the
    conversation to review; a bare "1" is scored. Not handled specially. It
    needs a lead who is mid-questions *and* was rung by an agent *and* rang
    back - unusual, since agents call leads who have finished - and the
    result, at worst, is a lead in Needs review, which a person reads.

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

## Opting back in - Decided by Jeel, 2026-09-22

**START lifts the block.** A lead who texts START, UNSTOP, YES or SUBSCRIBE is
asking to hear from us again, and EZ Texting re-subscribes them on its side. If
our block stayed, the two records would disagree and we would keep ignoring
someone who asked us not to.

- **Every reason is released, including one an agent set.** Jeel's call: the
  person is asking whatever the block was for. Worth knowing in use: someone who
  told an agent "don't call me" and then texts START has asked for texts; this
  restores both, because one list covers texts and calls.
- **The row is kept, not deleted.** `released_at` and `released_reason` are
  filled in, so the history reads "blocked on the 22nd, released on the 22nd" -
  the compliance record the design brief asks for. Only rows with
  `released_at IS NULL` block a send, which is what the poller, `sendMessage`
  and Admin > Leads all check.
- **The conversation is not reopened.** A `suppressed` conversation is finished.
  The START itself is stored and flags the lead, and anything the lead sends
  next is stored too and reaches an agent as an inbound reply (rule 2). (An
  agent's DNC outcome suppresses an open conversation the same way a STOP
  does - since 2026-10-01; before that it was left open, and a START after it
  was read as an unclear answer.) The
  questions do not restart.
- **Opting out again re-blocks the same row**, clearing the release dates, so a
  number never accumulates rows.
- A START from a number we hold no lead for still releases a block we hold, and
  still creates nothing.

---

## Tests the state machine needs

All against the pure function, no database:

- Every path through the antibiotics flow, with its texts, score and tier.
- "No" on question 1 goes to the offers question, not question 2; neither
  offers ending earns the completion award.
- A word answer ("yes", "nope", "agent", "learn more") and a near-miss number
  ("1.", "Option 2", "#3") each count as valid.
- A number the question does not have ("3" on question 1) is unclear.
- A sentence containing a valid word is unclear, not an answer.
- One unclear reply → that question's clarification, same question. A second
  → `review`.
- Unclear, valid, then unclear on the next question → clarification, not
  review, because the count reset.
- STOP on any question → `suppressed`, number blocked, nothing sent.
- STOP after `completed` → number blocked, status stays `completed`.
- Any reply after `completed`, `review`, `expired` or `suppressed` → nothing
  sent, conversation unchanged, flagged for a person.
- `responded` is awarded once only, however many replies arrive.
- A flow with five questions, defined in the test, runs on the same code.

Plus integration tests for the webhook wiring, in the style of
`backend/src/api/__tests__/webhooks.test.ts`.

---

## Open items

Found in review on 2026-10-06, waiting for a decision:

- **"No" to question 3 has no answer of its own.** "Ready to move forward?"
  answered "no" or "not yet" is an unclear reply, and a second one sends "a
  representative will follow up with you directly" and the lead to Needs
  review. Left as it is: this lead did ask for information, so a person
  following up is not wrong the way it was on the offers question (fixed the
  same day - "No thanks", above).
- **A second text sent before the next question arrives is read as its
  answer.** "Yes" and then "yes" again a moment later answers question 1 and
  then question 2 - which the lead has not seen. The lock above keeps the two
  in order; it cannot know the second was not meant for the new question. The
  answer row cannot be corrected afterwards.

**Parked:** EZ Texting's automatic STOP and HELP replies are the account's own
wording, not ours. On 2026-10-05 the HELP reply still read "PillRx Alerts";
the client said it has updated it. Our texts sign as eDrugstore.
