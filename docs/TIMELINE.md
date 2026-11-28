# Lead timeline

Everything that happened to a lead, in one ordered list: its texts, calls, notes,
callbacks and outcomes, what the activity log alone records, and the moments the
lead's conversation reached - received, scored, taken over, expired.
`GET /api/leads/:id/timeline`, open to any signed-in user. `backend/src/db/timeline.ts`
builds it; `frontend/src/components/Timeline.tsx` words it, for the Lead Timeline
page (`frontend/src/pages/LeadTimelinePage.tsx`) and - through `callText` and
`systemText` - the workspace's conversation (`frontend/src/pages/workspace/Conversation.tsx`).
Brief: `DESIGN-PROMPT.md` sections 3 and 4.

## How it works

`getTimeline` reads each source in turn - one query at a time, so a screen polled
every 5 seconds holds one of the pool's connections, not seven - turns each row into
an entry, adds the system events, and sorts the lot. Each entry carries a `kind`, a
time (`at`), an author where an agent acted, and its own `detail`. The API returns
what happened; the screen decides the icons and wording, as it does for queue tags.

### What it is built from

| Source | Entry `kind` | What it carries |
|---|---|---|
| `messages` | `inbound` - a reply; `sms` - one of ours (`sent_by` null); `agent_sms` - an agent's own text | The body; for ours and an agent's, `deliveryStatus`; for a reply recorded as an answer, `answer` - the choice's label |
| `calls` | `call` | `outcome`, `durationSec`, `direction`, `agentId`; on the robot's call `scriptResult` and `answers`; on a call Seri took `seri`; a recorded call's `transcript` |
| `notes` | `note` | The body |
| `callbacks` | `callback` | `scheduledAt`, `doneAt`, `reason`; on one Seri booked, her `note` |
| `dispositions` | `disposition` | The value |
| `activity_log`, the actions with no row of their own (`TIMELINE_ACTIONS`) | `activity` | The action and its detail, and `subject` - whose claim was released or whose callback was moved, when that is not who did it |
| The lead and its newest conversation | `system` | The events below |

`TIMELINE_ACTIONS` is a pick-up, a release, a call back nobody had being taken,
a callback moved or reopened, a text refused for a blocked number, and a call
refused. A note, an outcome, a call and a booked callback are already there from
their own tables; listing them again from the log would say everything twice
("Log entries", below).

A robot call Twilio never placed for our account's reasons (`not_placed`) is not
on it: it never reached the lead (`AUTO-CALLS.md`, "When Twilio refuses").

### System events

The events no table records are worked out from the lead and its newest
conversation, each standing on a time that actually exists:

| Event | Placed at | Words |
|---|---|---|
| `lead_received` | When the lead reached us (`ezt_added_at`, else `created_at`); carries the source | "Lead received from API" |
| `scored` | `completed_at` once the flow has finished; before that, the last inbound reply - the one that earned the points so far. Only with a score above 0 and a tier | "Scored 60 · HOT · completed" |
| `agent_took_over` | `agent_took_over_at` (`STATE-MACHINE.md` rule 2b) | "Agent took over - automated questions stopped" |
| `phone_took_over` | The lead's first answer on the robot's call - or first words to Seri on a call she took, unless the voicemail message took it - or call to us, since the conversation began; only while the questions were still running, and not when an agent's text came first (`STATE-MACHINE.md` rule 2d) | "Phone call - automated questions stopped" |
| `conversation_expired` | `expires_at`, only when the status is `expired` | "Conversation expired" |

An event with no time to stand on is left out rather than guessed at.
`updated_at` moves on every change, so it is never used. `expires_at` is set on
every send, so a live conversation always has a future one that has not happened -
hence only an expired conversation shows it.

**The `scored` event carries how the questions ended** (`endOutcome`). A lead who
asked only for offers, or to hear from a rep, or said no to both has a `completed`
conversation too; the line reads "Scored 10 · LOW · offers only", "· wants a call"
or "· not interested" rather than "· completed", which reads as the questions
answered. The Lead Timeline page's Status row uses the lead header's words for the
same reason.

### The order

Oldest first, newest at the bottom, so the list reads like a conversation. Ties are
common enough to matter: `scored` shares a time with the reply that earned it, and
`lead_received` with the opener it triggered. Within the same instant the order is:
received, then a reply, then a text of ours or an agent's, then a call, a note, a
callback, an outcome or a log entry, then the other system events - so the story
reads in the sequence it happened. A label marks each day where it changes - Today,
Yesterday, Wed, Oct 14 - through the same rule as the workspace's conversation
(`dayLabel`; `AGENT-WORKSPACE.md`, "A label wherever the day changes").

### Messages

One table gives three kinds - a reply, one of ours, and an agent's - split on
`direction` and `sent_by`. A reply recorded as an answer carries it, `detail.answer`:
each row of `conversation_answers` names the inbound text it was read from
(`message_id`), so the label comes with the message and nothing is guessed. The
workspace shows it beside the reply - "1 | Yes" - and adds nothing when the lead
typed the answer's own words. A text of ours or an agent's that EZ Texting refused
reads "Delivery failed".

### Calls

`components/Timeline.tsx`, `callText`:

| Call | The line |
|---|---|
| An agent's | "Outbound call · answered · 2:14", "Outbound call · no answer", "· voicemail", "· busy"; "· in progress" while it has no outcome |
| A lead calling us | "Incoming call · answered · 1:15"; "Missed call · told we will call back"; "Incoming call · ringing" while it rings |
| The robot's | By how its script ended, below |

Only an answered call shows its length. A recorded call's transcript is under it,
closed until opened (`TWILIO.md`, "Recordings and transcripts").

### The robot's call

It carries `scriptResult` - how its script ended, null while it is going - and
`answers`, what the lead said: each with its question named as every screen names
one (`questionShort`, "Q1"), which asking it was, what was heard and any key pressed,
and what it was taken to mean. So an agent opening the lead sees what already
happened before they call. The words are `lib/call-results.ts`, shared with Admin >
Leads' Call column:

| `scriptResult` | The line |
|---|---|
| `transferred` | Automated call · said yes · Maya Chen took it · 2:14 - the name in the line, so not again beside it |
| `transfer_missed` | Automated call · said yes · nobody took it - not "nobody free": people may have let it ring, or the lead hung up waiting |
| `voicemail_left`, `link_sent`, `not_interested`, `opted_out`, `no_response`, `hung_up` | Automated call · voicemail left, · link sent, · not interested, · opted out, · no response, · hung up |
| `unanswered` | Automated call · no answer - or busy, or failed: Twilio's word for why |
| `callback_booked` | Automated call · callback booked - Seri's alone |
| none yet | Automated call · in progress - worded as its own, never as an agent's |

Under the line, closed until opened like a transcript, **Answers**:
`Q1 · "yeah sure" → Yes`, `Q2, asked again · pressed 2 → No`, `Q1 · "what is
this" → not understood`, `Q1 · nothing said`, `Q1 · pressed 9 → stop`
(`components/CallAnswers.tsx`). The same line and fold are in the workspace
conversation and on the Lead Timeline page - one `callText` for both. They are not
on the lead card's answers, which are the text questions'.

### A call Seri took

Under the call, below **Answers** and closed the same way, **Seri**: each line in
the order said - "Lead" in the lead's colour, then "Seri" - then how her part ended:
"Booked a call back: Mon, Nov 16 3:00 PM", "Put through to a person", "Texted the
link", "Asked not to be called - number blocked", "Ended - not interested" (or
wrong person, told to call 911, no response, three minutes up), or "Seri stopped -
the call went on with the script" when she failed; the script's own answers after
that fallback are in **Answers** above it (`components/SeriConversation.tsx`). It is
there for the agent who takes the transfer or the call back, so the lead does not
repeat themselves.

`detail.seri` on the call (`seriPart`, `db/timeline.ts`) is `turns` - the lead's and
hers from `call_ai_turns`, her `system` notes left out - and `ended`, the action she
ended with as `calls.ai_ended_with` records it. An action she chose that was never
carried out - the voicemail message took the call - is not shown as how it ended,
and nothing is when the lead hung up first. A fallback Twilio's side caused has no
action of hers and reads as one all the same. Absent on a call she did not take
(`AI-AGENT.md`, "Data").

### Callbacks

| Callback | The line |
|---|---|
| Booked by a person | "Callback scheduled for Thu, Nov 13 3:00 PM", by the agent it is for |
| A missed call's (`missed_call`) | "Callback added · missed call"; done, "Missed call returned" |
| Seri's (`ai_booked`) | "Callback booked by Seri for Thu, Nov 13 3:00 PM · Wants to order antibiotics", with no author |
| Any, once done | "Callback completed (was Thu, Nov 13 3:00 PM)" |

`CALLBACKS.md` has the kinds and what finishes each.

### Log entries

`activityText`, from `AUDIT.md`'s actions:

| Action | The line |
|---|---|
| `lead.picked_up` | "Picked up the lead" |
| `lead.released` | "Put the lead back in the queue", "Lead released - outcome saved", or "Released the lead from Maya Chen" when forced - each with "· held 40 min" |
| `callback.taken` | "Took the callback Seri booked for Thu, Nov 13 3:00 PM" |
| `callback.rescheduled` | "Callback moved from ... to ..." |
| `callback.reopened` | "Callback reopened - it had been marked done" |
| `sms.blocked` | "Text not sent - the number is on the do-not-call list" |
| `call.refused` | "Call not placed - the lead was not picked up", "- the number is on the do-not-call list", "- the lead could not be found" |

Each is labelled `LOG` (`components/Timeline.tsx`). An incoming or missed call, and
the callback the system books for one - "Callback added · missed call", then "Missed
call returned" - are on the timeline from `calls` and `callbacks`, so `call.incoming`,
`call.missed` and `callback.done` are in the log but never shown as `LOG` entries. The
workspace's conversation shows no `LOG` entries: it stays the text thread, with calls
and system lines. The rest of the log - sign-ins, account changes, DNC history - has no
screen (`AUDIT.md`, "What the log does not cover").

### The Lead Timeline page

`/leads/:id/timeline` (`pages/LeadTimelinePage.tsx`): the lead's whole history,
read-only, full width, with a summary sidebar - opened from the workspace's "Full
timeline →", Admin > Leads and the DNC list. It uses `components/Timeline.tsx` and is
read from the top: the list does not jump to its end under the reader.

- **The header:** the name, the phone and source under it, the tier and score, and
  Pick up or Resume - or "Held by <name>" and no button on a lead someone else holds,
  a superadmin included (`FRONTEND.md`, "The one-agent lock on screen"). Calling and
  texting are done from the workspace.
- **Under a call**, each closed until opened: what the lead said on the robot's call
  (`CallAnswers.tsx`), Seri's conversation (`SeriConversation.tsx`, its end in words by
  `seriEndedText`) and the transcript (`CallTranscript.tsx`, one speaker's sentences
  joined into one line) - the same folds as in the workspace's conversation.
- **The sidebar is worked out from the timeline** (`summarise`), not from another
  endpoint: Status, Attempts (calls, texts out, texts in - an agent's call and the
  robot's count, one the lead placed does not), Last contact, Next action ("Callback
  3:00 PM · Maya Chen"), DNC and the dispositions. Counting what the page already
  holds costs nothing and cannot disagree with it.
- **Two of the brief's sidebar rows have no data and are shown as gaps** ("Not
  done"): Consent ref, and Duplicate check.
- **A failed load says so** - a banner, with "Showing the last update" when there is
  one.

## Rules

1. **Oldest first,** ties ranked so the story reads in the order it happened.
2. **An event with no time to stand on is left out,** never guessed at.
3. **The API says what happened; the screen words it.**
4. **Each fact comes from one place:** a row's own table, or the log only for an
   action with no row of its own.
5. **A lead that does not exist is null,** so the route answers 404 rather than an
   empty list, which is a lead with no history yet.
6. **One query at a time.**

## Data

Reads `leads`, the newest `conversations` row, `messages`, `conversation_answers`,
`calls`, `call_transcripts`, `call_answers`, `call_steps`, `call_ai_turns`, `notes`,
`callbacks`, `dispositions`, `activity_log` and `users`; writes nothing -
`SCHEMA.md`.

## Code

| File | What it does |
|---|---|
| `backend/src/api/lead-workspace.ts` | `GET /api/leads/:id/timeline` |
| `backend/src/db/timeline.ts` | `getTimeline`, `systemEvents`, `TIMELINE_ACTIONS`, `callAnswers`, `seriPart`, the order |
| `backend/src/db/lead-state.ts` | `phoneStoppedQuestionsAtSql`, `RECEIVED_SQL`, `newestConversation` |
| `frontend/src/components/Timeline.tsx` | The list and its words: `callText`, `systemText`, `activityText` |
| `frontend/src/components/CallAnswers.tsx`, `frontend/src/components/SeriConversation.tsx`, `frontend/src/components/CallTranscript.tsx` | What the lead said on the robot's call; Seri's conversation; a call's transcript |
| `frontend/src/lib/call-results.ts` | The robot call's result in words |
| `frontend/src/pages/LeadTimelinePage.tsx` | The full-width page, with its summary sidebar |
| `frontend/src/pages/workspace/Conversation.tsx` | The workspace's own list, sharing the words |

## Tests

| What | Where |
|---|---|
| The merge, the order and the system events against a real database; a reply carrying the answer it was recorded as, when an earlier answer was typed as a word; the robot's call with its result and answers; Seri's conversation on a call she took, and how her part ended | `scripts/timeline-live-check.ts` |
| The route: 404 for no such lead | `api/__tests__/timeline.test.ts` |
| The words, "Delivery failed" on a refused text - ours or an agent's - included | `components/Timeline.test.tsx`, `pages/workspace/Conversation.test.ts` |
| The summary sidebar | `pages/LeadTimelinePage.test.ts` |
| A call's transcript: closed until asked for, speakers joined, nothing for an unrecorded call | `components/CallTranscript.test.tsx` |
| The robot call's answers in words - said, pressed, asked again, not understood, stop, nothing said - and the fold | `components/CallAnswers.test.tsx` |
| A call Seri took: her lines and the lead's in order, how her part ended in words, nothing for a call she did not take | `components/SeriConversation.test.tsx` |
| The robot's call in words, the timeline's capitalised | `lib/call-results.test.ts` |
| A lead's whole history, the robot's and Seri's calls included | `npm run e2e` - `backend/scripts/end-to-end.ts` |

## Not done

- **System events come from the newest conversation only.** An earlier
  conversation's score and expiry are not shown - B12 changes this.
- **Consent ref** reads "-" on the Lead Timeline page, so nobody wonders whether
  the page forgot it, and **State** is not shown: EZ Texting sends neither
  (`EZTEXTING-API.md`).
- **Duplicate check always reads "This number has not been seen before"**, and there
  is no "Previous lead" section: both need repeat-lead handling, not built
  (`STATE-MACHINE.md`, "A number that comes back").
- **Every taken call back reads as Seri's.** `callback.taken` for a deactivated
  agent's call back carries `from`, but `activityText` ignores it, so the line says
  "Took the callback Seri booked for ..." (`CALLBACKS.md`, "A call back nobody
  has").
- **A recording's audio is not played** in the app (`TWILIO.md`).

## History

- 2026-11-27 · Written, from `AGENT-WORKSPACE.md`'s "The timeline", the lead card's answer labels and its known gaps; merged in: the Lead Timeline page from `FRONTEND.md`, and the log's place on screen from `AUDIT.md` · docs standard · D22, D26, D10
- 2026-11-23 · `Timeline`'s `autoScroll`, left over from when the workspace used it, removed with its ref (a `<div>` inside an `<ol>`); the page header's two states written down - Pick up and Resume, "Held by" for anyone else's, a superadmin included · review Q7, R15
- 2026-11-22 · The Lead Timeline page spun for ever when a load failed; it is a banner since · review M31
- 2026-11-22 · The sources read one at a time: all seven at once took seven of the pool's ten connections on a screen polled every 5 seconds - a few people looking, and every other request waited. Each is quick: with 50,000 leads the whole timeline reads in 3 ms (`npm run speed`). A call carries `agentId`, so the incoming-call card's "you tried 2× today" matches by id, not a name two people can share · review M18, M32
- 2026-11-13 · `phone_took_over` also for a lead's first words to Seri, unless the voicemail message took the call · A20 doc check
- 2026-11-12 · A call Seri took carries her conversation and how her part ended (A19); `callback_booked`, and Seri's call backs - booked, and taken on a pick-up, `callback.taken` among the log entries (A15, A16) · A15, A16, A19
- 2026-10-27 · `phone_took_over`: a phone call stopped the questions (rule 2d) · Jeel, T25 doc check
- 2026-10-27 · An agent's refused text reads "Delivery failed" too; before, it read as sent on this page
- 2026-10-24 · The robot's call carries `scriptResult` and `answers`, worded by its result, with the Answers fold · T21
- 2026-10-18 · The robot's call on the timeline, "Automated call · in progress", worded as its own; Attempts counts it as one of ours; the day separators say Today and Yesterday, through the workspace's `dayLabel` · T5, W1
- 2026-10-06 · A reply carries the answer it was recorded as (`detail.answer`, from `conversation_answers.message_id`, migration 012). The screen had worked it out from the chips, walking them in order and matching digits - wrong whenever an earlier answer had been typed as a word: "yes", "2", "1" showed "1 | Yes" on the third reply, which meant "I know which antibiotic", and the antibiotics flow made worded answers the ordinary case; two walks on one lead mislabelled the first with the second's answers. Found in review. The `scored` event carries `endOutcome` · flows
- 2026-10-02 · A recorded call's transcript under it · Phase 4
- 2026-10-01 · Calls on the timeline, and the actions from `activity_log` with no row of their own - a pick-up, a release, a callback moved or reopened, a text blocked, a call refused; a missed call's callback reads "Callback added · missed call", then "Missed call returned" · Phase 4, `AUDIT.md`
- 2026-09-29 · `scored` placed at `completed_at` once the flow has finished. It had always been placed at the last reply, so a lead texting "Hi" after finishing moved "Scored · completed" down under the "Hi" - found testing with a real lead · migration 004
- 2026-09-26 · Built: one merged list from `messages`, `calls`, `notes`, `callbacks` and `dispositions`, with the system events worked out - Phase 3 task 5; the Timeline component, task 18; the Lead Timeline page, task 21, with Consent ref and the duplicate check shown as gaps
