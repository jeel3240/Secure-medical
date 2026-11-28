# The robot's script

What the robot's call says and how it hears the answer: the script as rows, how a
spoken or keyed answer is read, when the call listens, what follows each answer, and
the voicemail message. Part of the robot's call - [`AUTO-CALLS.md`](AUTO-CALLS.md) is
who is called and how a call is placed; [`AUTO-CALL-TRANSFER.md`](AUTO-CALL-TRANSFER.md)
is what happens after a "yes". The rules are pure, in
`backend/src/core/call-script.ts` and `backend/src/core/answers.ts`; the script is
read by `backend/src/db/call-script.ts`, each answer kept by
`backend/src/db/auto-calls.ts`, and the TwiML made in
`backend/src/integrations/twilio.ts`.

## How it works

### The script

It is the antibiotics bucket's script (`call_scripts.bucket_id`): every script is
in a bucket, and a bucket has at most one active - a new bucket's calls are Seri's
(`BUCKETS.md`).

As it is said. The app only texts, so the client's email branch and the email line
in the voicemail are dropped; a lead who does not want a text is a No. The opening
says the offer first and ends on one short yes-or-no question, in Google's
Chirp3-HD **Kore**, US English (`call_scripts.voice`). "won't" and "didn't" are
written out, since Kore's "we won't call you again" sounded like "we will call you
again", the opposite of the line after a stop.

```
Q1  "Hi, this is Seri calling from eDrugstore. Today we're offering 25% off
     antibiotics. Are you interested in ordering?"
      YES -> "Great, connecting you with a live agent now. Please hold."  -> transfer
      NO  -> "No problem - I'll just ask one more quick thing."            -> Q2

Q2  "Can we send you a link to see all our medication at discount prices?"
      YES -> "Perfect. Check your SMS."  (link texted)
             "Thanks! You'll get the link shortly. Have a great day."      Link sent
      NO  -> "Thank you for your time. Have a great day."                  Not interested

Not understood, first time:
      "Sorry, I did not catch that. Press 1 for yes, 2 for no, or 9 to stop these calls."
Not understood, second time:
      "Thank you for your time. Have a great day."                         No response
"Stop calling me", or 9, at any point:
      "Okay, we will not call you again. Goodbye."   (number blocked)         Opted out

Voicemail:
      "Hi, this is Seri calling from eDrugstore with a quick message - we're offering
       antibiotics at 25% off right now. We'd love to connect. Please call us back
       at (480) 470-8259. Thanks, and have a great day!"                   Voicemail left
```

The script is stored as rows (`call_scripts`, `call_steps`, `call_choices`), like the
SMS flow (`FLOWS.md`) but in its own tables - "Data". The voicemail's number is
`{callback_number}` in the row, filled with our calling number and read digit by
digit (`spokenNumber`).

### Understanding an answer

`matchSpokenChoice` in `core/answers.ts`, pure. In this order:

1. **A key pressed wins** - keys are never misheard: 1 and 2 are the step's choices,
   9 is stop, any other key is unclear - whatever was heard as well.
2. **A number said on its own** counts as that key: "one", "1", "nine" - and the
   words Twilio may write for them, "won", "to", "too". Only as the whole answer:
   "I need to think" is not a 2.
3. **Stop wins over anything else said**: any of the script's stop words - "stop
   calling", "stop", "remove me", "take me off", "do not call", "don't call",
   "unsubscribe" - anywhere in the sentence. "No, stop calling me" is stop. **Even
   when Twilio is unsure**: wrongly ending one call loses that call, while missing a
   real stop calls someone who asked not to be.
4. **A doubtful hearing is unclear**: Twilio sends how sure it is (0-1). Below 0.4
   (`auto_call_min_confidence`, read on every answer by `readMinConfidence`) the
   answer is not trusted and the question is asked again - with keys, which are
   always certain. No figure at all, or 0, is not counted against the answer, since
   some speech models send none. Every answer's figure is kept. On real calls clear
   answers came back from 0.52 to 0.999, and a clear "yes" as low as 0.53 with
   Deepgram: "yes" is the one to watch against 0.4.
5. **Otherwise the choices' words are found inside the sentence**, as whole words,
   longest phrase first, each word used once: "Yes, I am" and "Yeah sure" are Yes;
   "No, I'm not interested" is No - `not interested` takes those words before Yes's
   `interested` can. Exactly one choice found is that choice; both ("yes no", "not
   really interested") or neither ("maybe", "who is this") is unclear. Nothing said
   and nothing pressed is silence.

A sentence longer than 300 characters is not an answer. The SMS flow's matching
(`matchChoice`) is separate: there the whole reply must be the answer
(`STATE-MACHINE.md`).

### When the call listens

`splitForListening`: everything before a question's last sentence is said first with
nothing listening, so "Hello?" over the greeting is never the answer; the last
sentence - the question itself - is said with listening on, so an answer that starts
before it ends is heard. The `<Gather>` takes speech or one key, reports silence too,
and is given the step's words and the stop words as hints (`integrations/twilio.ts`).

### How fast

A key press is near-instant; a spoken answer leaves a short silence before the call
goes on. Measured on recorded real calls, split into its parts:

| Listening with | Twilio hearing the answer | The reply starting | Silence the lead hears |
|---|---|---|---|
| Twilio's own model, `speechTimeout` auto | 3.3 - 3.4 s | 0.6 - 0.8 s | 4.0 - 4.3 s |
| Twilio's own model, `speechTimeout` 1 | 2.1 s - 5.4 s when a noise restarted the wait | 0.7 - 0.8 s | 2.8 - 6.2 s |
| **Deepgram `nova-3`, `speechTimeout` 1 - in use** | **1.6 - 1.7 s** | 0.8 - 1.5 s | **2.4 - 3.3 s** |
| Twilio's short-answer model | no faster | - | - |

Deepgram is used (`SPEECH_MODEL`, `integrations/twilio.ts`): half Twilio's wait, and
surer of what it heard. Twilio does not fail over a provider's own model in an
outage; a spoken answer would then come back empty, and the call asks again for keys,
which need no speech service. Of the reply's start, our server takes about 0.2
seconds; the rest is Twilio making the voice - which also leaves about 0.9 seconds
between a question's lead-in and the question itself, each said on its own. How it
was measured, so it can be repeated, is in the ticket,
[`T13b`](auto-call-tickets/T13b-spoken-answers-faster.md).

### What the call does after each answer

`firstAsk` and `afterAnswer` in `core/call-script.ts`, pure - given the script, the
step, which asking it was, and what the answer was taken to mean, they say what to
say and what comes next (`CallAction`). The webhooks only carry it out.

| After | Said | Then |
|---|---|---|
| The lead picks up | The first step's question | listen |
| A choice that leads on (Q1 No) | Its reply, then the next step's question, together | listen |
| A choice that transfers (Q1 Yes) | Its reply | ring the people free - `AUTO-CALL-TRANSFER.md`, "The transfer" |
| A choice that sends the link (Q2 Yes) | Its reply | hang up, then text the link - `link_sent` |
| A choice that declines (Q2 No) | Its reply | hang up - `not_interested` |
| Not understood or silence, first asking | The step's repeat line, asking for keys | listen, the last chance |
| Not understood or silence, second asking | "Thank you for your time. Have a great day." | hang up - `no_response` |
| Stop, on any step and asking | "Okay, we will not call you again. Goodbye." | hang up, block the number - `opted_out` |

An answer on the second asking counts like one on the first. **A script that leads
nowhere it may** - an answer to a step it does not have, a next step that is missing,
or one that is not later than this one - ends the call with the no-response line,
marked as a broken script to be logged (`auto_call.broken_script`): a mistake in our
rows, never a loop and never a crash. Each answer is kept as a `call_answers` row
(`answerRecord`): a choice with its key and label as they are now, or what else it
was.

### On a live call

`handleAnswer` (`core/call-script.ts`) and `keepAnswer` (`db/auto-calls.ts`), from
`/auto/gather`:

- **The lead may already have hung up.** Twilio still asks `/auto/gather` after a
  hang-up, marked `CallStatus=completed`. With nothing said, nothing is kept: a
  hang-up, never silence to ask again about. With something said, it counts - a stop
  still blocks, a yes to the link is still texted - but nothing that needs the lead
  on the line, and ending for want of an answer is not their result.
- **Every part is safe to repeat**, since Twilio may send the same request twice: one
  answer row per asking, the result saved only if the call has none - never
  overwritten - and the number blocked only if it is not blocked already. All in one
  transaction.
- **Stop blocks the number** with reason `call_opt_out` and its `dnc.blocked` record,
  by the system (`db/dnc.ts`); texts and calls both stop. It also ends the lead's
  open text conversation (`suppressed`) - the same end state as a STOP text or an
  agent's DNC, so a later START is never read as an answer to a question nobody is
  asking. The DNC page names the reason "Said stop on automated call".
- **A yes to the link is texted** (`sendCallLinkText`, `db/lead-texts.ts`): the
  active script's `link_text`, on the lead's thread like every automated text, and
  refused for a blocked number. Only for the first copy of the request - the one that
  kept the answer - so Twilio repeating it never texts twice; and after Twilio has
  its answer, so the lead hears "check your SMS" without waiting on EZ Texting. A yes
  said as the lead hung up is still texted: they asked for it. `link_sent` is saved
  with the answer, before the text.
- **An answer stops the text questions**: once the lead has answered - a yes or a no
  kept - their next text is not taken as an answer to the SMS question they were on
  (always Q1: the robot calls only leads who never replied); it is kept for a
  person, Inbound reply in the queue. Silence or an unclear answer stops nothing; a
  stop has already ended the conversation. On a call Seri took, anything the lead
  said to her counts as the answer. This is rule 2d - `STATE-MACHINE.md`, "2d".
- **The call's end gives an unfinished script its result** (`/auto/status`,
  `settleAutomatedCall`): `unanswered` if it was never picked up, `hung_up` if it was
  and the script never reached its own end. A call Twilio would not place for the
  lead's own number is `unanswered` too; refused for any other reason it is
  `not_placed`, not the lead's call (`AUTO-CALLS.md`, "When Twilio refuses").

### Voicemail

When a machine answers, the voicemail message is left once its greeting is over -
"Hi, this is Seri calling from eDrugstore with a quick message... Please call us
back at 4 8 0, 4 7 0, 8 2 5 9..." - and the call ends, saved as `voicemail_left`.
The rules are pure, in `core/call-script.ts`: `machineVerdict`, `onVerdict`,
`voicemailLine`.

**How it is known.** Twilio listens beside the call from the moment it is answered
(`asyncAmd`, `DetectMessageEnd` - `AUTO-CALLS.md`, "How a call is placed") and posts
its verdict to `/auto/amd`: for a machine, once its greeting is over. The script
starts at once regardless, so a lead hears no delay.

**Twilio can be wrong, and a greeting can sound like an answer** - the two reasons
for the rule below:

- On real calls to a person Twilio mostly says `unknown` or `human` after a few
  seconds of listening - but it has said `machine_end_other`, after its full 30
  seconds, of a person who had said "Yes." and was being put through.
- A greeting is heard as an answer when it holds a word a choice accepts: "Sorry,
  **no** one is available" is a "No" to the first question.

**The beep decides** - `onVerdict`:

| Twilio says | Nothing answered yet | After an answer (a choice) | A key pressed, or someone took the transfer |
|---|---|---|---|
| `machine_end_beep` - the beep heard | the message | **the message** - the "answer" was the greeting | carries on - a person |
| `machine_end_silence`, `machine_end_other`, `machine_start` - no beep | the message | carries on - a person Twilio took for a machine | carries on |
| `fax` | hung up on (`unanswered`) | carries on | carries on |
| `human`, `unknown` | carries on | carries on | carries on |

A call whose script has its result already, or that is over, is left alone. Only the
first verdict is acted on: Twilio sends one, and a repeat changes nothing
(`recordAnsweredBy` keeps the first).

**On a call Seri took** the same rule holds: anything the lead said to her counts as
an answer, and a key pressed while she talked as a key. Her goodbye, the link or a
call back waits for the verdict - up to 15 seconds after her last line - so a
greeting she took for a "no" still gets the message when its beep comes
(`AI-AGENT.md`).

**Taking the call over** (`actOnVerdict`, `db/auto-calls.ts`): the call row is locked
while it decides - the same lock an answer is kept under (`keepAnswer`), so an answer
arriving at that moment waits, then finds the message has the call. The result is
saved first, then Twilio's API replaces whatever the call is doing - a question, a
transfer ringing, the hold music - with the message (`replaceCall`,
`voicemailTwiml`); refused - the call already over - the result is rolled back, and
the call's end gives it one as for any other. Only Twilio's own refusal counts as
one: a request that got no answer in time, or never reached Twilio, is taken as done
- Twilio may well have done it, and a call a machine answered is better ended than
asked on. A ring from hold the message cuts short is ended with it, `failed`, so its
person is free for another lead at once. A second's quiet comes after the message,
before hanging up, so the end of the message is not cut off.

**What Twilio sends after a takeover changes nothing** (`takenByVerdict`) - it is the
page the message replaced:

- `/auto/gather`, with what the greeting said ("...When you have finished recording,
  you may..."): not kept, nothing follows.
- `/auto/after`, when a transfer was ringing - reported `no-answer`, exactly as a
  ring let run out. Nobody is switched off, nothing more said.
- `/auto/ai-after`, the end of Seri's session the message replaced: her action is
  not carried out.

Each is logged as `auto_call.after_takeover` and nothing else - never as an answer
or a transfer.

**What is saved:** `script_result = 'voicemail_left'` (a fax: `unanswered`);
`answered_by`, Twilio's verdict as for every call; and the outcome `voicemail` - for
an automated call, only when the verdict took it over (`TAKEN_BY_VERDICT_SQL`,
`db/calls.ts`). A "machine" the call ignored - a person Twilio got wrong - stays
`answered`.

**A transfer does not check for a machine itself.** A machine's verdict that is acted
on hands the call to the message, and a verdict the call ignored is a person's -
whose yes must ring.

## Rules

1. **The script is rows, changed only by migration.** A migration that changes a line
   names the value it replaces and stops unless it changes exactly the rows it
   expects (018's pattern).
2. **A key is never misheard; stop wins over anything said; a doubtful hearing is
   unclear** - never a guess ("Understanding an answer").
3. **Every answer is kept**, one add-only `call_answers` row per asking.
4. **Each webhook is safe to repeat.** A result is saved once and never overwritten;
   a number is blocked once; the link is texted once.
5. **A stop blocks the number at once** and ends the text conversation, even when
   the lead has hung up.
6. **A script that leads nowhere ends the call politely** - never a loop, never a
   crash.
7. **The beep decides** on a machine; a key pressed, or a transfer taken, always
   means a person.

## Data

| What | Where |
|---|---|
| The script | `call_scripts` - one per script, each in a bucket, only one active and at most one per bucket; with the lines every step shares: stop, no response, voicemail, busy, hold and the place on hold (`hold_next_body`, `hold_place_body`), the link text and the voice. `call_steps` - the questions, each with its repeat line. `call_choices` - each answer: key, label, accepted words, reply, and either the next step or an ending (`transfer`, `send_link`, `declined`), never both. Seeded by migration 015, changed by 018 and 019, put in the antibiotics bucket by 026 |
| What the lead said | `call_answers`, one add-only row per answer: what Twilio heard, how sure, keys pressed, the choice it matched |
| The confidence an answer needs | `settings.auto_call_min_confidence`, 0.4 |
| The result | `calls.script_result`, `answered_by` and `outcome` (`AUTO-CALLS.md`, "Data") |
| A stop | `dnc_list`, reason `call_opt_out` (`AGENT-WORKSPACE.md` owns the blocking paths) |
| The link text | `messages`, like every text |

The columns are in `SCHEMA.md`. **The script's own words are on its `call_scripts`
row**, not in `settings`: they are the script's words, in eDrugstore's voice, and a
script for another group brings its own; `settings` keeps only the call center's
numbers. **Not the SMS flow's tables:** only one flow can be active, and two active
flows would make every poll fail (`startConversation`, `db/flows.ts`); the SMS rules
- points for replying, whole-reply matching, the endings the queue reads - do not
fit a call.

## Code

| File | What it does |
|---|---|
| `backend/src/core/call-script.ts` | The script's types and every pure rule: `firstAsk`, `afterAnswer`, `handleAnswer`, `splitForListening`, `answerRecord`; voicemail's `machineVerdict`, `onVerdict`, `voicemailLine`, `spokenNumber` |
| `backend/src/core/answers.ts` | `matchSpokenChoice` - a spoken or keyed answer; `matchChoice`, the SMS one |
| `backend/src/db/call-script.ts` | `loadActiveCallScript`, `loadCallScript`, `readMinConfidence` |
| `backend/src/db/auto-calls.ts` | `keepAnswer`, `settleAutomatedCall`, `actOnVerdict`, `takenByVerdict` |
| `backend/src/db/calls.ts` | `TAKEN_BY_VERDICT_SQL`, `recordAnsweredBy` |
| `backend/src/db/lead-texts.ts` | `sendCallLinkText` - the link; the missed-call text too |
| `backend/src/integrations/twilio.ts` | The call's TwiML: the question and its `<Gather>`, Deepgram (`SPEECH_MODEL`), the hints, `voicemailTwiml` |
| `backend/src/integrations/twilio-calls.ts` | `replaceCall` - the message in place of whatever the call is doing |
| `backend/src/api/twilio-webhooks.ts` | `/auto/answer`, `/auto/gather`, `/auto/status`, `/auto/amd` |
| `backend/src/core/call-script-fixtures.ts` | The script as a constant, for tests only - the live check holds it to the database |
| `backend/src/db/migrations/015_call_script.sql`, `018_call_opening_and_voice.sql`, `019_hold_line.sql` | The script's tables and words |

## Tests

| What | Where |
|---|---|
| Every way an answer is read: keys, numbers said, stop, confidence, words inside a sentence, unclear, silence | `src/core/answers.spoken.test.ts` |
| Every path of the script, a broken script four ways, the hang-up cases, the listening split, the voicemail rule and the message's words | `src/core/call-script.test.ts` |
| The script as agreed, word for word against the fixture; its guards; answers add-only; every script in a bucket, one active per bucket, the one-overall index still there | `scripts/call-script-live-check.ts` |
| The script lands in antibiotics, unchanged | `scripts/buckets-upgrade-check.ts` |
| One answer per asking, a result never overwritten, a stop blocking once and ending the conversation, the end settling an unfinished script; each voicemail branch on a real row, an answer during a takeover waiting, two verdicts at once | `scripts/auto-calls-live-check.ts` |
| An automated call `voicemail` only when taken over | `scripts/calls-live-check.ts` |
| The link and the missed-call text: their words, the thread, a blocked number getting neither | `scripts/lead-texts-live-check.ts` |
| The webhooks: each path, the same request twice, after a takeover | `src/api/__tests__/auto-call-webhooks.test.ts` |
| The TwiML: the split, Deepgram, the message | `src/integrations/twilio.test.ts` |
| Casey's yes, Riley's key 1, Avery's no and then yes to the link | `npm run e2e`, steps 11 to 13 |

## Not done

- **A voicemail's menu heard as a yes.** A greeting heard as a "yes" whose machine
  Twilio reports with no beep (`machine_end_silence`, `machine_end_other`) is put
  through, as a person who said yes would be: the rule cannot tell the two apart,
  and a person who said yes is the one not to lose. The agent who takes it hears a
  recording and hangs up. A beep after such a yes still stops the ring and leaves the
  message. Seen twice on production: the voicemail's own menu, "To review your
  message, press 1", heard as "One" and "1." and put through, with no message left.
  The fix is a Phase 7 ticket,
  [`A23`](ai-agent-tickets/A23-a-voicemail-menu-is-never-put-through.md).
- **The reply's voice** takes 0.8-1.5 s to start, and a question's lead-in and the
  question itself have about 0.9 s between them. Audio made once, in place of text
  spoken during the call, would shrink both; not built.
- **Inviting keys in the questions** ("...Say yes, or press 1.") was not needed once
  Deepgram listened.

## Decisions

| Decision | By | Date |
|---|---|---|
| No email anywhere: the email branch and the email line in the voicemail are dropped; a lead who does not want a text is a No | Jeel | 2026-10-15 |
| A doubtful hearing is unclear, and asked again with keys | Jeel | 2026-10-15 |
| The link texted on "yes" is the one the SMS script already sends, https://www.edrugstore.com/anti-ez | Jeel | 2026-10-17 |
| The opening: "Hi, this is Seri calling from eDrugstore. Today we're offering 25% off antibiotics. Are you interested in ordering?" - no "This is an automated call", the offer before the question. The client had been told on 2026-10-14 that it would say it | Jeel | 2026-10-18 |
| The voice: Google Chirp3-HD Kore, US English, chosen by ear on a real phone from five of Twilio's newer voices (Twilio lists them as public beta) | Jeel | 2026-10-18 |
| "won't" and "didn't" written out | Jeel | 2026-10-19 |
| Deepgram `nova-3` with a one-second end, after hearing six recorded calls | Jeel | 2026-10-19 |
| The beep decides: a beep after an answer is the greeting talking; a machine with no beep after an answer is a person | Jeel | 2026-10-23 |

## History

- 2026-11-28 · The script is the antibiotics bucket's; at most one active per bucket, beside one overall · B07
- 2026-11-27 · Written from `AUTO-CALLS.md`'s "The script", "Understanding an
  answer", "What the call does after each answer" and "Voicemail", to the area
  template; the real-call notes to the tickets' *As built* · docs to the standard ·
  D36
- 2026-11-16 · The voicemail's menu heard as a yes and put through, seen on production
  for the second time (first 2026-11-13) - A23, after Phase 7's deploy
- 2026-11-13 · On a call Seri took, anything the lead said to her counts as the
  answer that stops the text questions (rule 2d) - found in the doc check after A20
- 2026-11-12 · Voicemail while Seri talks: the same beep rule; her goodbye, the link
  or a call back waits up to 15 seconds for the verdict · A18
- 2026-10-27 · An answer on the call stops the text questions: rule 2d · W2
- 2026-10-24 · Voicemail: the message once a machine's greeting is over, the beep
  deciding. Until then every answered call a machine picked up was saved as
  `voicemail`, as for agents' calls - call 24, a transfer a person took, among them;
  and T15a ended a "yes" as `no_response` once Twilio's verdict said machine
  (`tookByMachine`, `core/calls.ts`, removed). Found by an independent read the same
  day and fixed: a ring from hold the message cut short stayed open a minute; Twilio
  not answering the takeover counted as a refusal; a request after a takeover could
  be logged as an answer or a transfer · T18
- 2026-10-23 · The beep decides, agreed with Jeel - the ticket's rule, any answer
  means a person, would have left no message on a greeting saying "no one is
  available" · T18
- 2026-10-19 · The questions on a live call: every path, a hang-up never silence,
  every part safe to repeat. The greeting said with nothing listening and the
  question with listening on - before, the whole question was deaf and answers said
  over its last word were lost. A stop also ends the text conversation - found in the
  doc check the same day. "won't" and "didn't" written out in migration 018 · T13
- 2026-10-19 · Deepgram `nova-3` with a one-second end: about 4 seconds of silence
  after a spoken answer down to 2.4-3.3 s; Twilio's short-answer model, tried, was no
  faster and far less sure · T13b
- 2026-10-19 · The link texted on a yes, once, after Twilio has its answer · T14
- 2026-10-18 · After the first real call, migration 018: the opening said "Hi, this
  is Seri calling from eDrugstore. This is an automated call. Are you interested in
  ordering antibiotics at 25% off today?" in Amazon Polly's Joanna (Neural), which
  sounded machine-made · T12
- 2026-10-18 · How an answer is read (T7), what follows it (T8), and the script as
  rows, its words on its own row rather than in `settings` (T6, migration 015)
- 2026-10-13 · The client's script, with an email branch and an email line in the
  voicemail
