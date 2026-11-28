# State machine

How a lead moves through the SMS qualification flow: what each reply does, what
gets sent, how it is scored, and when it stops. **This doc is the authority for
the flow** and wins over the mockup PDF where they differ. It holds the rules
every flow follows; the script itself - the questions, choices, replies and
points - is data, in `FLOWS.md` (the antibiotics flow there is the one new leads
get). The pure logic is `backend/src/core/state-machine.ts` and
`backend/src/core/answers.ts`, wired in from `backend/src/api/webhooks.ts` and
`backend/src/api/reply-flow.ts` (replies) and `backend/src/worker/` (the first
question, expiry). Related: `WEBHOOKS.md`, `POLLER.md`, `SCHEMA.md`.

## How it works

### The shape of a reply

The core is a pure function, with no database and no network, so every branch
is unit-tested:

```
step(conversation, reply, rules) -> { conversation', send: string[], blockNumber, needsPerson, answer }
```

`conversation` is the current row - status, the question the lead is on
(`current_question_id`; `step` is that question's position, an order, not a
number the screens print), `invalid_count`, score, tier, `end_outcome`, and
when an agent's text or a phone call took it over. `reply` is the text and
whether it is an opt-out; `rules` the flow, the tiers and settings. `send` is
the texts to send, in order, as **one** SMS - a choice's reply then the next
question, or a clarification alone - empty when nothing is sent; the caller
fills in `{first_name}` (`core/messages.ts`). On `blockNumber` the caller adds
the phone to `dnc_list`; on `needsPerson` it sets `has_unread_inbound` ("Which
replies need a person"); `answer`, when there is one, it writes to
`conversation_answers`.

The webhook loads the lead's newest conversation, calls `step` through
`applyReply` (`api/reply-flow.ts`), and saves the result in one transaction,
which it commits. Then, outside it, the text is recorded as `sending`, sent,
and its id recorded ("Sending").

**The conversation row is locked while that happens** (`FOR UPDATE`). Two texts
sent moments apart arrive as two requests at once; without the lock both could
read the same question, treat their text as the answer to it, and each send
the next question - the lead gets it twice and one answer is lost. The lock
holds one lead's row, so other leads' replies are handled in parallel.

Answer matching is its own pure function, which `step` calls:
`matchChoice(text, choices)` - the choice of the current question the reply
names, or null.

### States

| Status | Meaning | Automated questions? |
|---|---|---|
| `open` | Waiting for the answer to the question the lead is on | Yes |
| `completed` | The flow ended on a choice. `end_outcome` says how: `completed` (the questions are answered), `offers`, `wants_contact` or `declined` | No |
| `review` | Too many unclear replies; a person takes over | No |
| `suppressed` | Opted out | Never |
| `expired` | Went quiet past the expiry window | No |

Only `open` is ever advanced. The other four are final for that conversation.
The column says questions, not messages, because two automated texts sit
outside this flow ("The missed-call text", below).

### Scoring

Points come from the flow - each choice's `points`, and the flow's
`responded_points` and `completed_points` - and tiers from `tiers`, all read on
every reply, never cached, so a migration's change applies to the next reply.

| Award | When |
|---|---|
| Responded | Once, on the first inbound reply that is not an opt-out, valid or not |
| Answer | Each valid answer: that choice's points |
| Completed | Once, when the flow ends with the outcome `completed` - not on the offers branch |

**Score and tier are updated on every reply, not only on completion**: a lead
who answers question 1 and goes quiet is a real responder, with a tier like
everyone else. The queue does not show a lead partway through (`QUEUE.md`, "Who
is in it"); Admin > Leads shows the running score and tier. The tier is the
`tiers` row whose range holds the score - HOT 75-100, WARM 45-74, LOW 1-44; a
score of 0, no reply yet, has none. On the antibiotics flow a lead who finishes
scores 55 to 100, so LOW is a lead partway, in review - which keeps what it
scored, typically the 10 for responding - or one who said No (10).

### Expiry

- **The window opens when a text goes out.** A send of the first question, or
  of a text in this flow, that succeeds sets `expires_at = now +
  settings.expiry_days` (seeded 7) - so does a first question that timed out
  and may have gone ("Sending") - by `sendOpener` (`worker/opener.ts`, the
  poller and the retry) and `bumpExpiry` (`api/reply-flow.ts`), after the send
  returns. It is the window to reply to *that text*. An agent's own text and
  the two texts outside the flow do not move it; a failed send leaves it where
  it was, so a lead never actually messaged expires on schedule, not a week
  late. A conversation with no `expires_at` falls back to `created_at +
  expiry_days`, so none sits `open` for ever.
- **Each worker cycle marks `open` conversations past it as `expired`**
  (`worker/expiry.ts`), after the poll and in its own try/catch: expiring is
  local work that must go on while EZ Texting is unreachable. Nothing is sent.
  The sweep is idempotent: a second run in the same minute expires nothing.
- Only `open` conversations expire: a `completed` or `review` one is not
  waiting on the lead. A reply after expiry follows rule 2.

**Expired leads leave the agents' queue**, whether they never replied or
replied and then went quiet - unless something else puts them there: a missed
call, a missed "yes" on the automated call, or a due call back Seri booked
(`QUEUE.md`, "Who is in it"). Expiry takes none of those away. Both kinds stay
on Admin > Leads under Expired.

**An expired lead who texts again comes back** - the lead texting us, not the
partner sending the number again ("A number that comes back"). The reply gets
no automated answer (rule 2), but it is stored and flagged, so the lead is back
in the agents' queue tagged **Inbound reply** for an agent to follow up by hand;
the conversation stays `expired` and no questions restart. Once an agent picks
the lead - or saves an outcome - the flag clears and it leaves the queue again,
unless it has another reason to be there (`AGENT-WORKSPACE.md`, "Marking a
lead read"); looking at it does not. This holds whether or not the lead
ever answered before - texting us is interest either way. A number on
`dnc_list` never comes back, whatever it sends.

### Sending

- **Every send checks `dnc_list` immediately before sending**, automated or not -
  the first question, every text in the flow, an agent's own SMS, and the two
  texts outside the flow. `sendMessage` (`integrations/ezt-client.ts`) queries
  it and throws `BlockedNumberError` before calling the API, so no caller can
  forget. A bare number is normalised to E.164 first: comparing `16025550147`
  with a stored `+16025550147` would match nothing and text a blocked phone. A
  refused send still advances the conversation - the answer is recorded, only
  the text is withheld - and `conversation.advanced` says `"sent": false`.
- **Rendered and recorded.** Every automated send is rendered by
  `core/messages.ts` (`{first_name}`) and recorded in `messages` with the id EZ
  Texting returns, which links the lead's next reply back to it. The flow's
  questions and replies are sent whole, however long - a reply and its question
  are one text; the first question and the texts outside the flow keep to one
  segment, dropping the name if it would not fit.
- **The database commits first, then the send happens.** A failed send is logged
  and leaves the conversation where it is; the answer is not rolled back - the
  lead has answered, and losing that would be worse than a missing follow-up.
- **Recorded around the send** (`db/outbound.ts`): the row is written as
  `sending` first, so with the database down nothing is sent; EZ Texting's id is
  recorded after, and if that write fails the text went out, so the row stays
  `sending` rather than being marked refused and sent again.
- **A text EZ Texting refuses is kept, marked failed** (`db/outbound.ts`; an
  agent's own: `db/failed-sends.ts`) - `delivery_status = 'failed'`, no
  `ezt_message_id`, so no reply links to it and it starts no reply window; the
  thread shows a red "!". One refused because the number is blocked is not kept:
  it was never attempted.
- **A lead whose text did not go out is flagged for a person.** They answered
  and heard nothing; the conversation is on a question they never got, nothing
  retries it, and partway through they are not in the queue - so every lead who
  replied during an EZ Texting outage would sit unseen until expiry. The flag
  puts them in the queue as an inbound reply, the failed text in the thread. Not
  for a blocked number.
- **A send that timed out is not treated as refused.** Calls to EZ Texting give
  up after 30 seconds, and a text cut off that way may have gone. Its row stays
  `sending`, so it is never sent twice. **The first question is then taken as
  sent** - its reply window starts and `question_sent_at` is set, so a reply
  counts and the robot can call a lead who never answers. A later text of the
  flow that timed out flags the lead for a person, as any it could not send.

### When the opener is sent

**Immediately.** The first question goes out in the same poll cycle that finds
the lead, at any hour. There is no sending-hours window. A failed one is
retried - up to four times over about nine hours, and never more than 24 hours
after the lead arrived: `POLLER.md`, "Retrying a failed opener".

### The missed-call text

Two automated texts sit outside the flow: `message_missed_call` from
`settings`, sent once per call when a lead rings our number and nobody answers
(`INCOMING-CALLS.md`, "A missed call"), and the link a lead said yes to on the
automated call, in the active call script's `link_text` (`AUTO-CALL-SCRIPT.md`,
"On a live call") -
both from `db/lead-texts.ts`. Only when and their words differ; the rest is one rule:

- **To whom.** Any lead, whatever their conversation's status - `open`,
  `completed`, `review`, `expired`, or `suppressed` with the block since
  released. Only a live `dnc_list` row stops it, through the check every send
  makes.
- **It changes nothing in the conversation.** Recorded like any automated text
  (`sent_by` null), it does not advance a question, take the conversation over,
  or move `expires_at`.
- **A reply to it is an ordinary reply**: the conversation ended - stored and
  flagged for a person (rule 2), the usual case, and "ok, call me after 5"
  reaches an agent; taken over by an agent - the same (rule 2b); still `open` -
  the same (rule 2d), since the call before either text stops the questions.

### A number that comes back

The **partner delivering the same number again**, so the poller would find it
in EZ Texting - not the lead texting us after their conversation expired, which
is "Expiry" above.

**It is not handled.** The poller never sees a number it already holds: EZ
Texting keeps one contact per number, and a re-delivery updates that contact
without moving its `createdAt` (`EZTEXTING-API.md`, "One contact per phone
number"); a phone we already hold is skipped by the insert in any case
(`POLLER.md`). So a returning number starts nothing: no new conversation, no
text.

**One person is always one lead row.** The **newest** conversation is the one
that drives the flow, the queue and the status on Admin > Leads; any earlier
one is history, kept exactly as it ended. How a return will start a new
conversation is the Phase 8 design: `BUCKETS.md`, "One person, one lead" and
"Finding people: two groups per bucket".

## Rules

### What a reply does

Checked in this order. The first match wins.

#### 1. Opt-out - any status

The reply is an opt-out if the payload's `optOut` is true, or the whole message
is one of the STOP words (`WEBHOOKS.md`, "Opt-out and opt-in words").

##### What STOP does, end to end

| Who | What happens |
|---|---|
| EZ Texting, by itself | Sends the unsubscribe confirmation and marks the contact `optOut` (`EZTEXTING-API.md`, "STOP handling") |
| Our app | Adds the phone to `dnc_list`, reason `sms_stop` - unless it is blocked already, when its block, its reason and its one record stand |
| Our app | If the conversation is `open`, sets it `suppressed`. Other statuses keep their status; the `dnc_list` row is what blocks contact |
| Our app | Stores the STOP message on the lead, so the history shows it |
| Our app | **Sends nothing.** The lead must get exactly one unsubscribe confirmation, and EZ Texting sends it; one from us would reach them as a second. So `settings.message_stop` is never sent - it stays seeded only in case the account's own handling is ever switched off |

The block goes through `db/dnc.ts`, as on every path that blocks a number
(`AGENT-WORKSPACE.md`, "Blocking a number"). The same end state - the number
blocked, an `open` conversation `suppressed` - comes from an agent's DNC
outcome and from a lead saying stop on the automated call (`AUTO-CALL-SCRIPT.md`,
"On a live call").

The lead row stays. What is blocked is the **phone number** - `dnc_list` is
keyed on phone, so the block holds whatever lead or conversation the number
later belongs to. No automated text goes to it; a re-delivery is skipped by the
poller, and a blocked number we hold no lead for is saved as suppressed, with
nothing sent; agents cannot call or text it and the queue never shows it;
Admin > Leads shows it as Opted out. START lifts the block, but the
conversation stays suppressed and the questions do not restart ("Opting back
in").

#### 2. Conversation not `open`

`completed`, `review`, `expired` or `suppressed`: store the message, set
`leads.has_unread_inbound`, send nothing. A person sees it on the lead. The
conversation itself is not written to, nor on any reply that changes nothing in
it (2b, 2d): its `updated_at` keeps saying when it last moved
(`api/reply-flow.ts`).

#### 2b. An agent has taken the conversation over

Once an agent sends a manual SMS to a lead, the questions stop. The reply is
stored and `leads.has_unread_inbound` is set, exactly as in rule 2, and the agent
reads it on the lead. Nothing is scored, and no question and no clarification
goes out.

**Why.** The agent is having a conversation with the lead. A lead just asked
"when is a good time to call?" who answers "1" is answering the agent, and an
automated question landing on top reads as a broken system to the person we
are selling to. Losing the score matters little: a lead an agent is working is
not waiting in the queue. The lead keeps the score and tier it had earned,
short of the completion award. **Opt-out and opt-in are not affected**: rule 1
comes first, so a STOP after the handoff blocks the number and a START releases
it - an opt-out never depends on whether an agent happened to text first.

**How it is recorded:** `conversations.agent_took_over_at`, set by
`POST /api/leads/:id/messages` (`db/agent-sms.ts`) and passed to `step` as
`agentTookOverAt` by `api/reply-flow.ts`. The status does not change, so the
queue tabs and Admin > Leads are unaffected and expiry still applies - the
agent's own callback and outcome track the lead from then on. It is set only by
the first agent text (`COALESCE` - the tenth should not rewrite when the
handoff happened), only while the newest conversation is `open` (texting a
finished lead takes over nothing), and never by a send that failed or was
refused for a blocked number - the questions must not stop on a message the
lead never got. It is a time, not a true/false, because the timeline shows when
the handoff happened, beside the messages either side of it (`TIMELINE.md`,
`agent_took_over`).

#### 2c. A reply before our text has gone out

A lead texts "Yes" and, a second later, "yes" again - a double tap, or they
thought the first had not gone.

| Time | The lead | Without this rule | With it |
|---|---|---|---|
| 10:00:20 | Sends **Yes** | Question 1 = Yes. Question 2 starts on its way | The same |
| 10:00:21 | Sends **yes** again | Question 2 = Yes - a question they have not seen. Question 3 is sent on top of it | Kept in the thread. Nothing saved, scored or sent |
| 10:00:23 | Receives question 2 | ...and question 3 with it | Question 2 alone |
| 10:01:00 | Answers question 2 | Read as the answer to question 3 | Question 2 = their real answer |

Without it the wrong answer could not be corrected - an answer row is written
once - and its points moved the lead in the queue. Two unclear texts in a row
did the same to the one "sorry" a question allows, and sent the lead to review.

**The rule:** the conversation records when the text the lead has to answer -
a question, or its "sorry" - has actually gone out (`question_sent_at`). It is
cleared the moment we owe them one, and set once it has been sent. **A reply
that arrives while it is empty is not an answer**: the message is stored,
nothing else changes, nothing is sent (`repliedBeforeOurText` in
`api/reply-flow.ts`, logged `reply.before_our_text`).

- **Never for an opt-out.** STOP works whatever state anything is in.
- **Only while the questions are running.** A finished conversation, or one an
  agent's text or a phone call took over, is handled by rules 2, 2b and 2d.
- **If our text has been unsent for more than two minutes** it is not on its
  way - it failed, or was never tried - and the lead is waiting on something
  that will not come. Their reply is flagged for a person (`has_unread_inbound`,
  the queue's Inbound reply). A send gives up after 30 seconds, so two minutes
  is well clear of one still in flight.
- **This covers the first question too.** A lead who texts before it has gone
  out has not answered it.

**What it cannot catch:** a reply sent a few seconds after our text left,
while that text was still on its way to the phone. Nothing on our side can tell
that from a fast answer.

#### 2d. A phone call has taken the conversation over

The robot calls only leads who never replied, so their conversation is still
`open` on Q1. A "thanks" to the link the call texts, or "ok call me at 3" to the
missed-call text, would otherwise be read as an answer to Q1.

**The rule:** once the lead has **answered the robot's call** - a choice kept:
yes, no, or yes to the link - or **rung our number**, answered or not, the
questions stop, as after an agent's text (2b): a reply is stored, flagged for a
person (`has_unread_inbound`, the queue's Inbound reply), nothing is scored and
nothing is sent. The score so far stands.

- **Worked out, never stored** - `phoneTookOverAtSql` in `db/lead-state.ts`:
  the first such answer (`call_answers`, `result = 'choice'`) or call (`calls`,
  `direction = 'inbound'`) since the conversation began. Those rows are the
  record; nothing new is written. `api/reply-flow.ts` reads it in the same
  locked statement as the conversation, and `step` takes it as
  `phoneTookOverAt`.
- **A call Seri took** (`AI-AGENT.md`): she asks no question, so there is no
  choice to keep - anything the lead said or pressed to her (`call_ai_turns`,
  `who = 'lead'`) is answering the call, and stops the questions as a choice on
  the script does. Not when the voicemail message took her call over: what she
  heard then was a machine's greeting. A call where the lead said nothing to her
  stops nothing, as silence on the script stops nothing.
- **Only a call since this conversation began.** A call to an earlier one stops
  nothing in a new one.
- **Not a call where nothing was understood** - silence, or an unclear answer
  and no choice: the lead has told us nothing, and the questions go on. A stop
  said on the call ends the conversation itself (`suppressed`).
- **Below rule 1**, like 2b: STOP works whatever happened before.
- **Below 2b**: once an agent has texted, the screens name the agent's text,
  whichever came first.
- **Shown** while the questions would otherwise be running
  (`phoneStoppedQuestionsAtSql`) - on the lead's page (`AGENT-WORKSPACE.md`,
  "The lead card") and the timeline (`TIMELINE.md`, "System events"), whose
  words they are. Never for a conversation that completed or went to review -
  none can after such a call, since the replies that would take it there are no
  longer read - nor for one `suppressed`, before the call or after.

Not covered: an agent's own call that the lead answers. It goes to leads who
have finished, as a rule; an agent who reaches one mid-questions texts, which is
2b.

#### 3. A valid answer to the current question

`matchChoice` returns one of the current question's choices. Accepted, as the
whole reply:

| Form | Examples |
|---|---|
| The choice's number | `2`, `2.`, `(2)`, `Option 2` |
| One of its words - each flow's lists are in `FLOWS.md` (`flow_choices.words`) | `no`, `Nope.`, `yes 👍` |
| Its name, as the screens show it (`flow_choices.label`) | `Talk to an agent` |
| The option as it was printed: the number, then text beginning with a word or the name of that same choice | `1. Yes`, `2) Talk to an agent for options & discounts` |

Before matching, the reply is lower-cased and everything that is not a letter
or a digit becomes a space - so punctuation, brackets and emoji never decide the
outcome - and a leading `option` is dropped (`normaliseReply`).

- **Only the choices that question has.** A question with two choices has no
  `3`.
- **The whole message must be one of the accepted forms.** No matching inside a
  sentence, or "no, I want to talk to someone first" would count as No, and "I
  don't know which one" as "know".
- **Anything else is unclear** and goes to rule 4 - every sentence, and anything
  ambiguous. A person reads those. `1 no` names two choices, so it is neither.
- **A message over 80 characters is never an answer**, and is not examined: an
  answer is a number or a few words.
- **The same word can mean different things on different questions.** On the
  antibiotics flow "yes" answers q1, q2 and the offers question; "call" only q3.

On a valid answer:

- Write one row to `conversation_answers`: the question, the choice, and the
  choice's label and points as they are at that moment.
- Reset `invalid_count` to 0.
- Add the choice's points ("Scoring").
- **If the choice names a next question:** move the lead to it, and send the
  choice's reply and that question as one text.
- **If the choice ends the flow:** status `completed`, `end_outcome` from the
  choice, the completion award if that outcome is `completed`, and send the
  choice's reply.
- **If the choice names a question the flow cannot go to** - one it does not
  have, or one at or before the current question, which would ask it again and
  score it twice - the rows are wrong, not the lead: the answer is kept, the
  status becomes `review`, and the flow's review text is sent. No completion
  award. The database refuses most such rows (`FLOWS.md`, "Rules the database
  enforces"); this is for what it cannot.

#### 4. Anything else - an unclear reply

- If `invalid_count` < `settings.max_invalid_before_review` (seeded `1`):
  increment it and send the question's own clarification
  (`flow_questions.clarify_body`). The lead stays on that question.
- Otherwise: status `review`, and the flow's review text is sent. The
  conversation stays on the question the lead could not answer, so the screens
  can say where they got stuck.

**One clarification per question, and each repeats that question's options**,
so the lead is reminded what the numbers mean.

**The count is per question.** It resets to 0 on every valid answer: a lead who
fumbles question 1 and then answers it should not arrive at question 2 already
one mistake from review.

An unclear reply still earns the "responded" points ("Scoring").

### Which replies need a person

`leads.has_unread_inbound` means *a person has to read this*. It is the queue's
Inbound reply and decides who is in the queue, so it is set only when the
questions cannot handle a reply: rule 2, rule 2b and rule 2d. `step` returns
this as `needsPerson`, so the rule lives beside the others. A lead with no
conversation, or one with no flow to follow, is flagged too - nothing handles
their message - and so is one whose conversation is on a question its flow does
not have. Two more cases, in `api/reply-flow.ts`: a reply while our text has
been unsent for over two minutes (rule 2c), and a lead whose text back failed
("Sending"). Not flagged by the reply itself: a valid answer, an unclear reply -
the clarification or the move to review is the response, and `review` is how
that lead reaches a person - and an opt-out.

### An answer keeps what it was

An answer is its own row in `conversation_answers`, written once when the reply
is accepted and never changed - the table refuses edits - holding the choice's
**label and points as they were at that moment**. The client renames choices,
adds new ones and changes points: a lead who chose "Supplements" last week must
still read "Supplements" after choice 1 is renamed, and their breakdown must
still add up after the points change. Once a flow changes, what an earlier lead
was offered cannot be recovered, so it is kept from the start. The screens show
the saved label and points - the queue, the lead card and its breakdown, the
incoming-call card, the conversation. Changing a flow changes what the next
lead gets, never what an earlier one has.

### Opting back in

**START lifts the block.** A lead who texts a START word (`WEBHOOKS.md`,
"Opt-out and opt-in words") is asking to hear from us again, and EZ Texting
re-subscribes them on its side; if our block stayed, the two records would
disagree and we would keep ignoring someone who asked us not to.

- **Every reason is released, an agent's included** - the person is asking
  whatever the block was for. Someone who told an agent "don't call me" and then
  texts START has asked for texts; this restores both, since one list covers
  texts and calls.
- **The row is kept, not deleted.** `released_at` and `released_reason` are
  filled in, so the history reads "blocked on the 22nd, released on the 22nd" -
  the compliance record the design brief asks for. Only rows with
  `released_at IS NULL` block anything - what the poller, `sendMessage` and
  Admin > Leads all check.
- **The conversation is not reopened.** A `suppressed` conversation is finished:
  the START is stored and flags the lead, and what they send next reaches an
  agent as an inbound reply (rule 2). An agent's DNC outcome suppresses an open
  conversation as STOP does, so a START after it is the same.
- **Opting out again re-blocks the same row**, clearing the release dates, so a
  number never gathers rows. **A START from a number we hold no lead for**
  still releases a block we hold, and creates nothing.

## Data

Read and written on every reply: `conversations` (status, question, counts,
score, tier, `end_outcome`, `completed_at`, `question_sent_at`, `expires_at`;
`agent_took_over_at` is written by `db/agent-sms.ts`) - one `open` per lead;
`conversation_answers`, add-only; `leads.has_unread_inbound`; `messages`;
`dnc_list`, through `db/dnc.ts`, read before every send. Read: `settings`
(`expiry_days`, `max_invalid_before_review`, `message_missed_call`), `tiers`,
the flow tables (`FLOWS.md`), and for rule 2d `call_answers`, `calls` and
`call_ai_turns`. Every column is in `SCHEMA.md`.

## Code

| File | What it does |
|---|---|
| `backend/src/core/state-machine.ts` | `step` and `tierFor` - every rule here, for any flow |
| `backend/src/core/answers.ts` | `matchChoice` and `normaliseReply` - a reply against one question's choices |
| `backend/src/api/reply-flow.ts` | `applyReply`: loads and locks the newest conversation (`loadNewestConversation`) and its rules (`loadRules`), applies rule 2c (`repliedBeforeOurText`), runs `step`, saves the conversation and the answer, then sends and moves the reply window (`bumpExpiry`) |
| `backend/src/api/webhooks.ts` | Receives the reply, decides whether it is an opt-out or opt-in, blocks or releases the number, flags the lead - `WEBHOOKS.md` |
| `backend/src/db/flows.ts` | Reads a flow; starts a conversation on the active flow's first question (`startConversation`). The first question - the lowest position - is picked in SQL there and in `findOpenersNeverSent` |
| `backend/src/db/lead-state.ts` | `phoneTookOverAtSql` and `phoneStoppedQuestionsAtSql` - rule 2d |
| `backend/src/db/agent-sms.ts` | An agent's own SMS, and the 2b take-over time |
| `backend/src/db/dnc.ts` | `blockNumber`, `releaseNumber`, `isBlockedNow` |
| `backend/src/db/outbound.ts` | `sendAndRecord` - every automated text recorded around its send |
| `backend/src/db/lead-texts.ts` | The missed-call text and the link text |
| `backend/src/integrations/ezt-client.ts` | `sendMessage` - the `dnc_list` check before every send |
| `backend/src/core/messages.ts` | `renderMessage` - `{first_name}`, the one-segment limit |
| `backend/src/worker/opener.ts` | `sendOpener` - the first question, and its reply window |
| `backend/src/worker/expiry.ts` | `expireStaleConversations` - the sweep |

Two things are deliberately not where the spec's sketch might suggest:

- **Opt-out detection stays in `api/webhooks.ts`,** which holds the keyword
  lists. The core is told the outcome through `reply.optOut`, so there is one
  list rather than two that drift. `blockNumber` on the result is what drives
  the `dnc_list` write, so the rule itself lives in the core.
- **The send is a closure, not part of `applyReply`.** `applyReply` returns
  `{ result, send }`: the caller commits the transaction, then calls `send()`.
  That order is the rule - a failed send must not roll back an answer the lead
  has already given - and two steps mean the caller cannot get it wrong by
  accident.

## Tests

| What | Where |
|---|---|
| Every path through the antibiotics flow with its texts, score and tier; No on question 1 to the offers question, none of its endings earning the completion award; one unclear reply - the clarification, a second - `review`, the count reset by a valid answer; STOP on any question, and after `completed`; any reply after the flow ended, after an agent's text (2b) or a phone call (2d) - nothing sent, flagged, STOP still blocking; `responded` once; a five-question flow defined in the test, and rows that lead nowhere or backwards | `backend/src/core/state-machine.test.ts` |
| Word answers ("yes", "nope", "agent", "learn more") and near-miss numbers ("1.", "Option 2", "#3") counted; a number the question lacks ("3" on question 1), a sentence holding a valid word, `1 no`, over 80 characters - unclear | `backend/src/core/answers.test.ts` |
| The webhook wiring: the flow advancing, flagging for a person, the lock, the send after the commit, the reply window, a reply before our text (2c) | `backend/src/api/__tests__/webhooks.test.ts` |
| 2b and 2d through the real reply path: no question, score or clarification after an agent's text, none recorded for a failed or refused one; answered the robot, then "thanks" and "1"; nothing understood, then "1" answered; rang us, then a text; a call before a new conversation; a finished lead who rang; talked to Seri, then "thanks"; a key pressed to her; she spoke and the lead said nothing; her call taken by the voicemail message | `backend/scripts/agent-sms-live-check.ts` |
| 2d through the webhook, with the link text | `backend/scripts/end-to-end.ts` |
| A saved answer keeping its label and points when a choice is renamed and re-scored | `backend/scripts/lead-detail-live-check.ts` |
| The sweep's statement - only `open`, overdue, no `expires_at` falling back to `created_at` - the database mocked | `backend/src/worker/expiry.test.ts` |
| An expired lead in the queue only for its reply, and leaving once read | `backend/scripts/queue-live-check.ts`, `backend/scripts/read-flag-live-check.ts` |

## Not done

- **A returning number starts nothing** ("A number that comes back"). Planned in
  `BUCKETS.md`; `POLLER.md`, "Not done", has what the poller would need.
- **"Seen before"** - a queue tag for a lead with an earlier conversation - does
  not exist: no lead has more than one conversation by that path.
- **A reply sent just after our text left can still be miscounted** (rule 2c,
  "What it cannot catch").
- **A first question that timed out is never sent again** ("Sending"): sending it
  twice is the worse mistake.
- **EZ Texting's own STOP and HELP replies** are the account's wording, not ours
  (`EZTEXTING-API.md`, "STOP handling"). Our texts sign as eDrugstore.
- **The missed-call text's words** were drafted here and wait for the client's
  word.

## Decisions

| Decision | By | Date |
|---|---|---|
| This doc is the authority for the flow. The mockup is a reference for screens and wording, not for flow logic: it contradicts itself (page 2 shows a STOP confirmation, page 3 says send nothing) and leaves cases undefined | Jeel | 2026-09-19 |
| No STOP confirmation of our own - EZ Texting sends one | Jeel | 2026-09-19 |
| One clarification per question, repeating that question's options | Jeel | 2026-09-19 |
| The unclear count is per question, reset by every valid answer | Jeel | 2026-09-19 |
| Score and tier updated on every reply, not only on completion | Jeel | 2026-09-19 |
| Expired leads leave the agents' queue, whether they replied or not | Jeel | 2026-09-19 |
| An expired lead who texts again comes back as an Inbound reply; the conversation stays expired | Jeel | 2026-09-19 |
| The first question goes out at once, at any hour - no sending-hours window | Jeel | 2026-09-19 |
| One person is one lead row; a return would be a new conversation on it - confirmed for Phase 8 in `BUCKETS.md` | Jeel | 2026-09-19 |
| START lifts the block, whatever its reason - an agent's DNC included - keeping the row | Jeel | 2026-09-22 |
| 2b: an agent's first text stops the questions | Jeel | 2026-09-23 |
| Only replies the questions cannot handle flag a lead for a person | Jeel | 2026-09-28 |
| 2c: a reply before our text has gone out is not an answer | Jeel | 2026-10-06 |
| 2d: a lead who answered the robot's call or rang us has the questions stopped | Jeel | 2026-10-27 |

## History

- 2026-11-27 · Rewritten to the area template: the rules under Rules with their
  numbers, the decisions in a table, test counts dropped; the antibiotics flow
  moved to `FLOWS.md`, the keyword lists left to `WEBHOOKS.md`; "Seen before"
  no longer called a computed tag - it was never built; the read flag said to
  clear when a lead is picked, not opened; "A number that comes back" brought
  to today, its old rules kept below (2026-09-19); rule 2d's screen words left
  to `AGENT-WORKSPACE.md` and `TIMELINE.md`; from `SCHEMA.md`, why 2b is a time
  and the first flow's LOW tier · `docs/DOCS.md` · D23, D24, D09
- 2026-11-27 · Checked on the test account: a number delivered again does not
  move its contact's `createdAt` (`EZTEXTING-API.md`, "One contact per phone
  number"), so a return cannot be found by date · `BUCKETS.md`
- 2026-11-23 · A reply that changes nothing is no longer saved - it was written
  back unchanged on every reply, so `updated_at` did not say when the
  conversation last moved; `firstQuestion()`, called only by its tests, removed:
  the first question is picked in SQL · review Q6, R12
- 2026-11-22 · A first question that timed out is taken as sent. Taken as
  unsent, a reply in the next two minutes was dropped - not scored, not flagged
  - and, the retry never sending twice, the lead sat until it expired. A STOP
  from a number already blocked leaves its block, reason and record as they
  were · review H12, M40
- 2026-11-13 · Rule 2d covers a call Seri took. Before, a "thanks" to the link
  she texted got Q1's "Sorry, please reply 1 for Yes or 2 for No." - the fault
  2d was written for · the doc check after A20
- 2026-10-27 · Rule 2d, found in the T25 doc check: a "yes" on the robot's
  call, the link it texts, or a call back nobody answered changed nothing in the
  lead's open conversation, so "thanks" to the link text, or "ok call me at 3"
  to the missed-call text, was read as an answer to Q1, got "Sorry, please
  reply 1 for Yes or 2 for No." back, and a second one sent the lead to Needs
  review. Named 2d, since 2c was taken · T25 found it, W2 built it (in
  `AUTO-CALLS.md`'s tracker until 2026-11-27)
- 2026-10-19 · A stop said on the automated call blocks the number and
  suppresses the conversation, as STOP does · T13
- 2026-10-06 · Rule 2c; a lead whose text did not go out flagged for a person;
  a choice leading where the flow cannot go sends the lead to review - before,
  it was quietly marked completed; matching cleans every non-letter and a
  leading "option" - until then only a trailing `.!?,;:` was dropped, so "1.
  Yes", "No, thanks" or an emoji got "Sorry, please reply 1 for Yes or 2 for
  No" and went to a person on the second try; "yes please" and "no thank you"
  added to the words · review of Phase 5
- 2026-10-05 · The script became data, the antibiotics flow (`FLOWS.md`), before
  the first real lead; a reply and the next question sent as one text. The HELP
  reply still read "PillRx Alerts"; the client said it has updated it · Phase 5
- 2026-10-05 · An answer keeps its points as well as its label, as its own row
  (migration 012) · Phase 5
- 2026-10-01 · The word a lead chose kept with each answer, in columns -
  migration 009, "The word is kept with the answer", before any choice was
  renamed · Jeel
- 2026-10-01 · The missed-call text, the first automated text outside the flow -
  so the States table says questions, not messages; an agent's DNC outcome
  suppresses an open conversation as STOP does - before, it was left open and a
  START after it was read as an unclear answer · Phase 4
- 2026-09-28 · Only replies a person has to read set `has_unread_inbound` - it
  was set on every reply, so every responder read as an inbound reply;
  migration 003 (part 2) cleared the old flags (`SCHEMA.md`). The queue stopped
  showing leads partway through ("Stalled at Q1 / Q2" gone); picking a lead,
  not looking at it, clears the flag. Every automated send recorded around the
  send, a refused one kept as failed; the opener retry (`POLLER.md`) · Phase 3
- 2026-09-26 · Rule 2b built: `agent_took_over_at`, set by an agent's first
  text · Phase 3 task 9
- 2026-09-22 · Expiry built, on every worker cycle; the deadline moved only once
  a text has gone out - before, it moved as soon as the flow decided to send, so
  a failed message bought another week. Verified on a database: of seven
  conversations the two overdue `open` ones expired (one with no
  `expires_at`), the future and fresh `open` ones did not, and overdue
  `completed`, `review` and `suppressed` were untouched; a reply to an expired
  one set the flag and sent nothing - nothing cleared it until the agent
  workspace (`db/read-flag.ts`). The conversation row locked during a reply:
  holding one for six seconds, that lead's reply waited while four others
  finished in 0.2 s each. START lifts the block, keeping the row (migration
  002)
- 2026-09-21 · The `dnc_list` check moved inside `sendMessage`, so no caller can
  forget it · Phase 2
- 2026-09-21 · The first flow, health & wellness - three questions of three
  choices - walked against the account; kept, inactive, as `wellness` · Phase 2
- 2026-09-19 · Scoring as answers arrive, not only on completion: on the first,
  three-question flow a finished lead could not score below 40, and of its 27
  answer combinations 13 were HOT, 13 WARM and one LOW (a test asserted the
  split until migration 012) - LOW was for leads who replied and stalled, as the
  mockup's "Responded, stalled at Q1 - 10 LOW" shows, and at 50-100 leads a day
  those are not rare · Phase 2
- 2026-09-19 · Written as the spec of the flow, overriding the mockup;
  decisions were marked **Decided** in the text, and what was built when left
  to CLAUDE.md §10. A STOP texted to the account showed EZ Texting confirms it
  itself and marks the contact `optOut`. Jeel also decided, never built, how a
  returning number would be handled, from its block status and its newest
  conversation: blocked or `optOut` - nothing, ever, and added to `dnc_list`;
  `open` - nothing, since restarting would send question 1 to someone partway
  through; `completed`, `expired` or `review` - a new conversation on the same
  lead, clean (no answers, `invalid_count` 0, score 0, no tier), opener sent;
  `suppressed` - nothing, ever. The earlier conversation kept as it ended, and
  shown by a computed "Seen before" tag; the lead taking the new delivery's
  `ezt_added_at`, `source`, `group_id`, `group_name`, and name and email where
  given, so its age counted from its return. It waited on EZ Texting showing a
  re-delivery at all - by date it does not (2026-11-27). Phase 8 replaces it:
  `BUCKETS.md` holds a person with a review conversation rather than
  restarting them · Phase 2
