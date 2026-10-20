# Automated outbound calls

**Planned 2026-10-15. Being built: T0 to T15b are done (2026-10-20) - the
server places a call, asks the script, keeps every answer, texts the link, and
puts a "yes" through to the lead's own agent first, then everyone free;
switching off a person who let a transfer ring out (T15c) onwards, and the
robot calling by itself (T20), are not built yet.** This
doc is the agreed design and the tracker for building it. Each ticket below updates its row when it is merged,
and the sections it touches, so the doc always says what is built and what is
not.

## Why

Most leads never answer the SMS questions. The client asked (2026-10-13) for
them to be called quickly by an automated call, between 11am and 5pm, with a
short script, and passed to a live agent when they say yes.

It is built in two stages, agreed with the client on 2026-10-14:

| Stage | What | When |
|---|---|---|
| **1** | A scripted call that follows the client's script word for word. The lead answers by voice ("yes", "no") or keypad (1, 2) | Now - this doc |
| **2** | When the lead says something outside the script, an AI agent takes over **inside the same call** - no second number, no transfer | Later, its own plan |

**Production stays exactly as it is until `AUTO_CALLS=on` is set on the
server.** Every ticket is merged and deployed with it off: the header switch,
group rings, the call-back change and the dialler all depend on it.

Development uses a **second Twilio number** on the same account (added by the
client on 2026-10-15), never production's (480) 470-8259 - `TWILIO.md`, "What
it needs on the Twilio account".

## The script

As it will be said. The client's version (2026-10-13) had an email branch and
an email line in the voicemail; **the app only texts, so both are dropped**
(Jeel, 2026-10-15). A lead who does not want a text is a No.

**No "This is an automated call" line, the offer before the question, and a
natural voice** (Jeel, 2026-10-18, after hearing the first real call): the
opening was "Hi, this is Seri calling from eDrugstore. This is an automated
call. Are you interested in ordering antibiotics at 25% off today?", in Amazon
Polly's Joanna (Neural), which sounded machine-made. It now says the offer
first and ends on one short yes-or-no question, in Google's Chirp3-HD
**Kore**, US English, chosen by ear on a real phone from five of Twilio's
newer voices (Twilio lists them as public beta). Migration 018 - which also
writes out "won't" and "didn't" (Jeel, 2026-10-19): Kore's "we won't call you
again" sounded like "we will call you again", the opposite of the line after
a stop.

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

The script is stored as rows (`call_scripts`, `call_steps`, `call_choices`),
like the SMS flow (`FLOWS.md`) but in its own tables - see "What is saved".

## The whole flow

```
LEAD ARRIVES
  -> text: question 1, at once (as today)
       replies -> the SMS flow, as today; never called
       no reply 1 hour after the text -> AUTOMATIC CALL, if all of these hold:
           inside 11am-5pm (else at 11am the next calling day, oldest first)
           someone is free to take a "yes", and nobody is on hold
           not picked up by an agent, not Closed, not blocked
           never called by the robot before
         no answer  -> No answer
         voicemail  -> the voicemail message -> Voicemail left
         picks up   -> the script above
  -> day 7 -> expires, as today

TRANSFER ("Great, connecting you with a live agent now. Please hold." + recording notice)
   lead already picked up by someone who is free -> they ring alone first, 25 s
       not free, or not taken -> on to everyone free; whoever takes it holds the lead
   otherwise -> everyone free rings for 25 s; the first to accept holds the lead
   nobody accepts:
       someone is on a call -> HOLD
           hold music, and "You are next." / "You are number 2 in line."
           checked again every 30 s:
               someone finishes (note saved or skipped) -> rings them first
               nobody on a call any more              -> busy line
               10 minutes (safety stop)               -> busy line
       nobody on a call -> busy line at once
   busy line: "All our agents are busy right now. An agent will call you back shortly."
       -> the lead goes to the top of the agents' queue as "Wants a call"

LEAD CALLS (480) 470-8259 BACK
   -> whoever holds them -> else the last agent who called them -> else everyone free
   -> nobody -> missed call, as today (TWILIO.md, "A missed call")
```

## The rules

### When a lead is called

- **1 hour after the first text**, if they have not replied (Jeel,
  2026-10-15). The worker checks every 30 seconds, so the call goes out within
  about 30 seconds of the hour being up.
- **Only 11am-5pm, Arizona time, Monday to Friday** (the client, 2026-10-13;
  the time zone and days Jeel's, 2026-10-17). A lead whose hour ends
  outside the window is called at the start of the next one, before newer
  leads.
- **Once.** No second call, whatever happened on the first (Jeel,
  2026-10-17): a lead who does not pick up still has the first text, and the
  voicemail asks them to call back. A second try may come later, when Jeel
  says.
- Only leads that arrive after `AUTO_CALLS` is first switched on - never the
  backlog.

### Who is free - the "Taking calls" switch

A switch in the app bar, next to the user menu, for everyone - agent or
superadmin. **The switch decides who is rung, not the role** (Jeel,
2026-10-15): a superadmin who works leads switches it on; one who does not
leaves it off and is never rung for a transfer.

- Off at every sign-in; the person turns it on. Signing out turns it off.
- **Letting a transfer ring out turns it off** (Jeel, 2026-10-15), with a
  short notice: "Missed a transfer · Taking calls off". It covers someone who
  walked away with it on: one lead is affected, not every lead until they
  return. It only happens to someone who was free when rung; someone on a
  call is never rung, so a call never turns it off.
- Every change is recorded in the activity log.

**Free** means: the switch is on, the app is open (the browser tells the
server every 30 seconds; silent for 2 minutes is gone), and not on a call or
with an after-call note open.

**The switch** - built in T10 (2026-10-18). `users.taking_calls`, off for
everyone to begin with (migration 017); `POST /api/calls/taking-calls`;
`layout/TakingCalls.tsx` in the app bar, beside the user menu - a small switch
that turns green when on. Each change is a `calls.availability_changed` row,
with `on` and `why`: `by_hand`, `sign_in` or `sign_out` (`api/taking-calls.ts`),
and only when it really changed - signing in with it already off records
nothing.

- **Shown, and accepted, only while automated calls are on** - `AUTO_CALLS=on`
  and calling set up (`auto-calls-settings.ts`, `api/index.ts`). Off, the
  route refuses (`auto_calls_off`) and the app bar has no switch.
- **It flips once the server has it.** A switch that showed "on" before it was
  saved could leave someone believing they will be rung when they will not. A
  failure leaves it where it was, and says so on hover.
- **Signing in turns it off even if another browser left it on**: the person
  chooses again. That other browser still shows "on" until it is reloaded -
  the safe way round, since it is not rung. T15c, which turns it off from the
  server, needs the browser told; noted there.
- A deactivated account is never free, whatever its switch says; signing in
  again after reactivation turns it off.

**Free, in one place** - `FREE_SQL` in `db/presence.ts`: an active account,
the switch on, the browser able to ring (`RINGABLE_SQL`), and no call of
theirs still going - checked on the server too, so a call counts the moment
it starts, not at the browser's next word. "Still going" is a call with no
outcome, started in the last 2 hours: a ring for an incoming call counts, an
automated call nobody has taken keeps nobody busy, and a call whose end
Twilio never reported stops counting after 2 hours - the window a missed
call's "under way" uses. A small index of the calls still going
(`calls_under_way_by_agent`, migration 017) keeps it instant. `freePeople`
lists them; a transfer rings them (T15a), T20 counts them.

**The app is open** - built in T9 (2026-10-18): `db/presence.ts` on the
server, `lib/presence.ts` and `lib/calling.ts` in the browser. Each signed-in
browser where calling is set up tells the server, every 30 seconds and at once
when it changes, whether it can take a call now: registered with Twilio, and
nothing on its screen keeping the person busy - a call being placed or live, a
lead ringing, or a finished call's note box still open. The server keeps the
word for two minutes (`users.ringable_until`), so a browser that closes, loses
its connection or sleeps stops counting by itself.

- **"Not available" is said, not left out**: the moment a call or a ring
  starts, and while Twilio cannot be reached. The server knows at once, or
  within half a minute, rather than in two minutes.
- The reports go one after another, each reading the screen as it is sent, so
  an older "available" can never land after a newer "busy".
- **Ending a session clears it at once**: signing out, being deactivated, a
  password change (`db/users.ts`, where every session ends). A deactivated
  account can never be made ringable.
- Leaving the app's pages without signing out - the Change password page -
  stops the browser ringing at once, and lapses on the server within two
  minutes, as a closed tab does.
- Not in the activity log: it is the present moment, overwritten every half
  minute (`AUDIT.md`).
- **Two tabs** of one person each speak for themselves, and the last word wins:
  a note box open in one tab while the other says "available" is not seen.
  T10's "not on a call", checked on the server, covers a call under way in
  either.
- T10 joins it to the switch and to "not on a call" as one rule, `FREE_SQL`
  (below); `RINGABLE_SQL` is its presence part.

### Understanding an answer

Built in T7 (2026-10-18): `matchSpokenChoice` in `core/answers.ts`, pure. In
this order:

1. **A key pressed wins** - keys are never misheard: 1 and 2 are the step's
   choices, 9 is stop, any other key is unclear - whatever was heard as well.
2. **A number said on its own** counts as that key: "one", "1", "nine" - and
   the words Twilio may write for them, "won", "to", "too". Only as the whole
   answer: "I need to think" is not a 2.
3. **Stop wins over anything else said**: any of the script's stop words -
   "stop calling", "stop", "remove me", "take me off", "do not call", "don't
   call", "unsubscribe" - anywhere in the sentence. "No, stop calling me" is
   stop. **Even when Twilio is unsure**: wrongly ending one call loses that
   call, while missing a real stop calls someone who asked not to be.
4. **A doubtful hearing is unclear** (Jeel, 2026-10-15): Twilio sends how sure
   it is (0-1). Below 0.4 (`auto_call_min_confidence`) the answer is not
   trusted and the question is asked again - with keys, which are always
   certain. No figure at all, or 0, is not counted against the answer, since
   some speech models send none. Every answer's figure is kept, and read on
   every answer from `settings`. **The first real calls** (T13, 2026-10-19)
   gave clear answers 0.52 to 0.95 - "No." 0.52-0.70, "Yes." 0.61, "No,
   thanks." 0.81, "Stop calling me." 0.95 - so 0.4 holds. With Deepgram (T13b)
   "no", "no thank you" and "stop calling me" came back 0.97-0.999, but a
   clear "yes" only 0.53: "yes" is the one to watch against 0.4.
5. **Otherwise the choices' words are found inside the sentence**, as whole
   words, longest phrase first, each word used once: "Yes, I am" and "Yeah
   sure" are Yes; "No, I'm not interested" is No - `not interested` takes those
   words before Yes's `interested` can. Exactly one choice found is that
   choice; both ("yes no", "not really interested") or neither ("maybe",
   "who is this") is unclear. Nothing said and nothing pressed is silence.

A sentence longer than 300 characters is not an answer. The SMS flow's
matching (`matchChoice`) is unchanged: there the whole reply must be the
answer.

**When the call listens** (T13, `splitForListening`): everything before a
question's last sentence is said first with nothing listening, so "Hello?"
over the greeting is never the answer; the last sentence - the question
itself - is said with listening on, so an answer that starts before it ends
is heard. T12 kept the whole question deaf, and the first real calls lost
answers said over its last word.

**How fast** (T13b, 2026-10-19) - a key press is near-instant; a spoken answer
left about 4 seconds of silence before the call went on. Measured on recorded
real calls, split into its parts:

| Listening with | Twilio hearing the answer | The reply starting | Silence the lead hears |
|---|---|---|---|
| Twilio's own model, `speechTimeout` auto | 3.3 - 3.4 s | 0.6 - 0.8 s | 4.0 - 4.3 s |
| Twilio's own model, `speechTimeout` 1 | 2.1 s - 5.4 s when a noise restarted the wait | 0.7 - 0.8 s | 2.8 - 6.2 s |
| **Deepgram `nova-3`, `speechTimeout` 1 - in use** | **1.6 - 1.7 s** | 0.8 - 1.5 s | **2.4 - 3.3 s** |
| Twilio's short-answer model (T13) | no faster | - | - |

Deepgram is used (`integrations/twilio.ts`): half Twilio's wait, and surer of
what it heard. Twilio does not fail over a provider's own model in an outage;
a spoken answer would then come back empty, and the call asks again for keys,
which need no speech service. Of the reply's start, our server takes about
0.2 seconds; the rest is Twilio making the voice - which also leaves about 0.9
seconds between a question's lead-in and the question itself, each said on
its own. Audio made once, in place of text spoken during the call,
would shrink both; not built.

*How it was measured* - repeatable: the test call recorded on both sides
through Twilio's recordings API (two channels, deleted after); in each
channel, speech found by loudness every 20 ms; the lead's last word, the
moment the answer reached our server (`webhook_events.received_at`) and the
reply's first sound lined up on the recording's clock.

### What the call does after each answer

Built in T8 (2026-10-18): `firstAsk` and `afterAnswer` in `core/call-script.ts`,
pure - given the script, the step, which asking it was, and what the answer
was taken to mean, they say what to say and what comes next. The webhooks
(T12 on) only carry it out.

| After | Said | Then |
|---|---|---|
| The lead picks up | The first step's question | listen |
| A choice that leads on (Q1 No) | Its reply, then the next step's question, together | listen |
| A choice that transfers (Q1 Yes) | Its reply | ring everyone free - "The transfer" (T15a) |
| A choice that sends the link (Q2 Yes) | Its reply | hang up, then text the link (T14) - `link_sent` |
| A choice that declines (Q2 No) | Its reply | hang up - `not_interested` |
| Not understood or silence, first asking | The step's repeat line, asking for keys | listen, the last chance |
| Not understood or silence, second asking | "Thank you for your time. Have a great day." | hang up - `no_response` |
| Stop, on any step and asking | "Okay, we will not call you again. Goodbye." | hang up, block the number - `opted_out` |

An answer on the second asking counts like one on the first. **A script that
leads nowhere it may** - an answer to a step it does not have, a next step that
is missing, or one that is not later than this one - ends the call with the
no-response line, marked as a broken script to be logged: a mistake in our
rows, never a loop and never a crash. Each answer is kept as a `call_answers`
row: a choice with its key and label as they are now, or what else it was.

**On a live call** (T13, `handleAnswer` and `keepAnswer`):

- **The lead may already have hung up.** Twilio still asks `/auto/gather`
  after a hang-up, marked `CallStatus=completed` - found on the first real
  call. With nothing said, nothing is kept: a hang-up, never silence to ask
  again about. With something said, it counts - a stop still blocks, a yes to
  the link is still texted - but nothing that needs the lead on the line, and
  ending for want of an answer is not their result.
- **Every part is safe to repeat**, since Twilio may send the same request
  twice: one answer row per asking, the result saved only if the call has
  none - never overwritten - and the number blocked only if it is not blocked
  already. All in one transaction.
- **Stop blocks the number** with reason `call_opt_out` and its `dnc.blocked`
  record, by the system; texts and calls both stop. It also ends the lead's
  open text conversation (`suppressed`) - the same end state as a STOP text
  or an agent's DNC, so a later START is never read as an answer to a
  question nobody is asking (2026-10-19, found in the doc check).
- **A yes to the link is texted** (T14, `sendCallLinkText` in
  `db/lead-texts.ts`): the active script's `link_text`, on the lead's thread
  like every automated text, and refused for a blocked number. Only for the
  first copy of the request - the one that kept the answer - so Twilio
  repeating it never texts twice; and after Twilio has its answer, so the
  lead hears "check your SMS" without waiting on EZ Texting. A yes said as
  the lead hung up is still texted: they asked for it.
- **The call's end gives an unfinished script its result** (`/auto/status`,
  `settleAutomatedCall`): `unanswered` if it was never picked up, `hung_up` if
  it was and the script never reached its own end. A call Twilio would not
  place is `unanswered` too.

### Traffic

The robot slows down and stops by itself:

- never more calls at once than there are people free;
- none while anyone is on hold;
- none when nobody is free;
- none outside 11am-5pm.

## How a call is placed

Built in T12 (2026-10-18). One path, `worker/place-auto-call.ts`, for the dev
command now and the dialler later (T20):

1. **The row first** - `startAutomatedCall` (`db/auto-calls.ts`), one
   transaction with the lead locked: the call's `calls` row
   (`direction = 'automated'`, no agent) and its `call.started` record. It
   refuses, writing no row and recording `call.refused` with why:
   `not_found`; `blocked` (the do-not-call list); `already_called` (one
   automated call per lead); `no_script` (none active); `not_test_number`.
2. **Then Twilio, once** - `integrations/twilio-calls.ts`, the only file that
   rings a phone through Twilio's API. Ten seconds and the library's own retry
   off: a request Twilio has not answered is given up, never repeated, since
   it may have gone out and a second could ring the lead twice.
3. **Twilio's answer.** Placed: its id is kept on the row. Refused (a 4xx):
   the row is ended as `failed`, recorded with Twilio's status and error code -
   never its message, which can quote the number. No answer, or a 5xx: the
   row is left as it is; if the call did go out, its first webhook fills in
   the id. A row whose call never went out stays without an outcome, and the
   lead is not called again - T20 decides how such a row is closed.

**Outside production, only our own phones are rung** - `AUTO_CALL_TEST_NUMBERS`
(`auto-calls-settings.ts`), comma-separated E.164 numbers. Empty, nothing is;
an entry that is not E.164 is ignored and counted. Production does not read
it. It is checked in step 1, so the dev command and the dialler both obey it.

**What Twilio is asked for** (`automatedCallRequest`): our number as caller
ID; the phone rings up to 60 seconds, long enough for a voicemail to answer;
voicemail detection beside the call, not in front of it (`asyncAmd`,
`DetectMessageEnd`), so the lead hears the question at once and the verdict
arrives later. Nothing is recorded: the recording, and its notice, start
only with a transfer ("The transfer").

**The call's webhooks** - each names the call's row, `?call=<id>`, in the
address Twilio signs, so the row cannot be swapped: a request for row 43
signed as row 42 is refused. A webhook whose row is not an automated call, or
is linked to another Twilio call, is not acted on. All six answer 404 while
automated calls are off, and 403 unsigned (`TWILIO.md`, "Why the webhooks can
be trusted").

| Webhook | Now | Later |
|---|---|---|
| `POST /api/webhooks/twilio/auto/answer` | The lead picked up: a second's quiet, the greeting with nothing listening, then the question itself inside a `<Gather>` - speech or one key, heard from its first word ("When the call listens"); silence reported too; the step's words and the stop words as hints. Anything wrong - no row, no script, the database down - ends the call quietly, never Twilio's "application error" | - |
| `POST /api/webhooks/twilio/auto/gather` | The answer read (`matchSpokenChoice`), what follows decided (`handleAnswer`), kept with its result and any block (`keepAnswer`), and the next line said - T13, "On a live call". The address names the step and which asking it was. A yes to the link is texted after Twilio has its answer (T14); a yes to the transfer rings the lead's own agent first, then everyone free (T15a, T15b, "The transfer") | - |
| `POST /api/webhooks/twilio/auto/status` | How it ended, saved as every call's end is (`finishCall`): outcome, talk time, `call.ended`; then an unfinished script given its result (T13). Never a missed-call text | - |
| `POST /api/webhooks/twilio/auto/amd` | Who picked up, kept as `answered_by`; a machine on an answered call makes it `voicemail` | T18: the voicemail message |
| `POST /api/webhooks/twilio/auto/claim` | A person accepted the transfer: the call and the lead become theirs (`takeTransfer`) - run on their leg before they are connected (T15a) | - |
| `POST /api/webhooks/twilio/auto/after` | The transfer's ringing is over: taken, nothing more; the lead's own agent did not take it, everyone else free rung (T15b); not taken, `transfer_missed` and the busy line (T15a) | T16: the hold line first |

**Trying it locally** - `npm run dev:auto-call -- <phone>` (`scripts/dev-auto-call.ts`)
calls the local lead with that number. It needs, in the environment the api
runs with: calling set up, `PUBLIC_URL` a tunnel, `AUTO_CALLS=on`, and the
number on `AUTO_CALL_TEST_NUMBERS`. No `twilio:configure`: each call carries
its own webhook addresses, so the number and the TwiML App are not involved.
Refuses in production.

One phone gets one automated call - one lead per number, one call per lead -
so two flags, for the local database only (T13):

- `--again`: when the lead holding the number has had its call, the number
  is given to a fresh test lead, as if the partner had sent it new, and that
  lead is called - otherwise the lead holding it is. The old one keeps all its
  history under a made-up number, `+1555` and its id; nothing is deleted.
- `--unblock`: lifts the block a stop test left on the number, released as
  `dev_test`, so the next test can call it.

## The transfer

Built in T15a and T15b (2026-10-20). A "yes" to a step whose choice ends in
`transfer` (Q1) is put through to a person, in `/auto/gather`; the rules are
pure, `planTransfer` and `planAfterHolder` in `core/call-script.ts`.

1. **Who can take it is read at that moment**: everyone free (`freePeople`,
   "Who is free"), who holds the lead, and Twilio's verdict on who picked up,
   if it has come (`transferContext`).
   - **A machine** (or a fax): nobody is rung - a voicemail greeting is not a
     lead saying yes. The no-response line, `no_response`; T18 leaves the
     voicemail message instead.
   - **The lead's own agent is free** (T15b): the choice's reply ("Great,
     connecting you with a live agent now. Please hold."), the recording
     notice, then they ring **alone** for `auto_call_ring_seconds`. Not free -
     on a call, away, or the switch off - they are not waited for: everyone
     free rings at once, below.
   - **Nobody free**: the choice's reply, then the busy line -
     `transfer_missed`, saved with the answer.
   - **Otherwise**: the choice's reply, the recording notice, then everyone
     free rung together (`transferTwiml`) - at most 10, Twilio's limit in one
     `<Dial>` - for `auto_call_ring_seconds` (25; read on every transfer, and
     25 when it is missing or not 5-60).

   Each ring carries the lead and marks itself a transfer - `ring=group`,
   `reason=transfer`, and the step said yes to - so the browsers show it as
   one (T11). The lead's own agent, rung alone, gets `ring=group` too: the
   ring goes on without them if they do not take it, so their browser treats
   it as any shared ring - it clears with no "Missed call", and is declined
   while they are busy. No report per person: the end is the call's own.
2. **The first to accept is connected**; Twilio stops ringing the rest. Before
   connecting them it runs `/auto/claim` on their leg: who they are is `To`,
   our own signed browser name; the call is `ParentCallSid`, matched to the
   row (`linkAutomatedCall`). `takeTransfer`, one transaction with both rows
   locked:
   - the call becomes theirs and `transferred` - from then on it counts as a
     person's work: Working, a missed call returned (T4);
   - **the lead becomes theirs, taken from anyone who held it** - a lead who
     said yes goes to whoever answered (Jeel, 2026-10-15). `lead.picked_up`
     records it with `via: transfer`, the call, and `tookOverFrom`;
   - `call.transferred` records taking the transfer, once per call, whoever
     held the lead.
   Refused - another person has the call, the account was deactivated while it
   rang, no such call - their leg is hung up before it is connected. A
   database error after they accepted still connects them: the lead is
   waiting for a person, and the error is logged (`auto_call.claim_failed`).
3. **When the ringing is over**, Twilio asks `/auto/after` with how it went
   (`DialCallStatus`); the address names the step and, after a ring to the
   lead's own agent, who they were. Taken - they talked, nothing more to say.
   The lead's own agent let it ring out, or declined: **everyone else free
   rings at once** (`planAfterHolder`) - not them, with nothing said, since
   the lead has been listening to it ring and has heard the notice; nobody
   else free, the busy line. Anything else - nobody accepted, or the lead hung
   up while it rang (`CallStatus=completed`; nobody further is rung) -
   `missTransfer`: `transfer_missed`, unless the call already has a result,
   and the busy line if the lead is still there. An agent calls them back;
   T22 puts them first in the queue.
4. **Recorded from the moment a person answers**, both sides apart, as every
   call is: the lead on channel 1, the person on channel 2 - so the
   transcript says who said what (`core/transcripts.ts`).

Not built yet: a person who lets a transfer ring out has their switch turned
off (T15c); the hold line before the busy line (T16).

**What the real transfers showed** (2026-10-20, Jeel's phone, two browsers on
the dev number):

- **The browser picks the lead up as it accepts** (`lib/incoming-call.ts`,
  `claimLead`), and that request can reach the server before Twilio's
  `/auto/claim`. The lead is then already theirs, so `lead.picked_up` is the
  browser's, without `via: transfer` - and nothing said a transfer was taken.
  `call.transferred` was added for that: it is written whichever arrives
  first.
- **One browser declining leaves the others ringing** - T11 relies on it. The
  Decline button and a busy browser's automatic decline are the same request
  to Twilio (`call.reject()`).
- **The channels are as above**, checked by saying different words on each
  side: the lead's on channel 1, the person's on channel 2 (T4 had assumed
  it).
- **About 44 seconds from the lead's "yes" to the busy line** when nobody takes
  it: about 19 for the reply and the recording notice, then the 25 of ringing.
- A finished transfer leaves its note box open, as every call does, and the
  browser counts as busy - not rung for the next transfer - until the note is
  saved or skipped (T9).
- **Reloading the window that is ringing turns the ring down** - Twilio reports
  `busy`, as for Decline - and the transfer goes on to the others (T15b, call
  24).
- **When the lead hangs up while it rings, Twilio says so**: `/auto/after`
  comes with `CallStatus=completed` (T15b, call 26), so nobody further is
  rung and nothing is said to an empty line.
- **Twilio's voicemail detection called a person a machine** (call 24): its
  verdict came after the lead had said "Yes." at 0.89, so the transfer went
  ahead, rightly - but the call's outcome was then saved as `voicemail`, as
  T12 does for any answered call a machine picked up. T18 must not act on a
  late "machine" once the lead has answered - "T18".

## What is saved

Nothing is overwritten (`AUDIT.md`).

| What | Where |
|---|---|
| The call | `calls`, with `direction = 'automated'`; `agent_id` empty until someone takes a transfer. `script_result`: `transferred`, `transfer_missed`, `link_sent`, `not_interested`, `opted_out`, `no_response`, `voicemail_left`, `hung_up`, `unanswered` |
| What the lead said | `call_answers`, one add-only row per answer: what Twilio heard, how sure, keys pressed, the choice it matched |
| The script | `call_scripts`, `call_steps`, `call_choices` - rows, changed by migration, like the SMS flow (015). The script's own words - stop, no response, voicemail, busy, hold, the link text - are on its `call_scripts` row, so another script brings its own |
| When it calls | `settings`: `auto_call_hours_start` 11:00, `auto_call_hours_end` 17:00, `auto_call_time_zone` America/Phoenix, `auto_call_days` mon,tue,wed,thu,fri, `auto_call_wait_minutes` 60, `auto_call_ring_seconds` 25, `auto_call_hold_max_minutes` 10, `auto_call_min_confidence` 0.4 |
| The link text | `messages`, like every text |
| Who is free | `users.taking_calls`, `users.ringable_until` |
| Every action | `activity_log` |

**Why not the SMS flow tables:** only one flow can be active, and two active
flows would make every poll fail (`startConversation`, `db/flows.ts`); the SMS
rules - points for replying, whole-reply matching, the endings the queue reads
- do not fit a call.

**A robot call is not an agent's work.** It does not make a lead Working and
does not answer a missed call - until an agent takes the transfer.

## Where it shows

| Screen | What |
|---|---|
| Lead timeline and workspace | "Automated call · voicemail left", "· said yes · Maya Chen took it · 2:14", "· link sent", "· not interested", "· opted out", "· no response", "· no answer" - with what the lead said underneath |
| Agents' queue | Only a "yes" nobody took: at the top, "Wants a call", until an agent calls, texts or closes the lead |
| Admin > Leads | A **Call** column with the last robot call's result, and a filter on it. No new status or tab - a lead is on two tracks at once ("Awaiting reply" and "Voicemail left") |
| Admin > Configuration | The call script, hours, time zone and texts, read-only |
| App bar | The "Taking calls" switch |
| Incoming-call card | "Transfer · said yes to the offer" |

## Tracker

One ticket = one branch off `dev` = one PR into `dev`, with its code, tests and
doc lines. The next starts after the last is merged. Status is updated in the
ticket's own PR.

| # | Ticket | Needs | Status |
|---|---|---|---|
| T0 | Resend the first texts the EZ Texting block stopped, slowly | - | Done 2026-10-16 - run on the server for the 174 leads of the block |
| | **Setup** | | |
| T1 | A laptop can never ring for production's calls | - | Done 2026-10-16 |
| T2 | `twilio:configure` cannot move production's number | - | Done 2026-10-16 |
| T3 | Set up the new number for local work | T1, T2 | Done 2026-10-17 - a real call each way on the dev number |
| | **Data and rules - no calls yet** | | |
| T4 | The database can hold a robot call | - | Done 2026-10-18 |
| T5 | The screens know a robot call from an agent's call | T4 | Done 2026-10-18 |
| T6 | The call script saved as rows | T4 | Done 2026-10-18 |
| T7 | Understanding a spoken answer | T6 | Done 2026-10-18 |
| T8 | What the robot does after each answer | T6, T7 | Done 2026-10-18 |
| | **Who can take a call** | | |
| T9 | The server knows who is online | - | Done 2026-10-18 |
| T10 | The "Taking calls" switch | T9 | Done 2026-10-18 |
| T11 | Several browsers ringing at once | - | Done 2026-10-18 |
| | **The call - on the dev number** | | |
| T12 | The server places one call | T3, T4, T6 | Done 2026-10-18 - a real call to Jeel's phone; the opening and voice changed after it (018) |
| T13 | The questions | T7, T8, T12 | Done 2026-10-19 - six real calls, every path |
| T13b | Spoken answers understood faster | T13 | Done 2026-10-19 - Deepgram: 4 s of silence down to 2.4-3.3 s, measured |
| T14 | Text the link | T13 | Done 2026-10-19 - the link reached Jeel's phone |
| T15a | The transfer: everyone free | T10, T11, T13 | Done 2026-10-20 - real transfers: taken, taken after a decline, taken by nobody |
| T15b | The transfer: the lead's own agent first | T15a | Done 2026-10-20 - real calls: rung alone first, then the others; not free, not waited for |
| T15c | Letting a transfer ring out turns the switch off | T15a | Not started |
| T16 | The hold line | T15a | Not started |
| T17 | The next free person gets the waiting lead | T16 | Not started |
| T18 | Voicemail | T12 | Not started |
| T19 | A lead calling back reaches someone | T10, T11 | Not started |
| | **Calling on its own** | | |
| T20 | The robot places the calls by itself | T12-T19 | Not started |
| | **Screens** | | |
| T21 | The timeline shows the robot calls | T13 | Not started |
| T22 | The queue puts a missed "yes" first | T15a | Not started |
| T23 | Admin > Leads: the Call column | T4 | Not started |
| T24 | Admin > Configuration shows the call script | T6 | Not started |
| | **Finish** | | |
| T25 | Everything written down and checked end to end | T0-T24 | Not started |
| T26 | Real phone, every path, then live | T25 | Not started |
| | **Other tickets - not calling** | | |
| W1 | Day dividers in the agent's conversation | - | Done 2026-10-18 |

### The tickets

Every ticket has the same parts:

- **Goal** - what is true once it is merged, in one sentence.
- **Needs** - tickets that must be merged first.
- **Production** - what the live app sees once it is deployed.
- **Build** - what to make.
- **Done when** - the checks; all of them pass before the PR is opened.
- **Files** - where the work is. **Doc** - what it updates, besides this tracker.

On top of each ticket's own checks, every PR passes `npm test`, `npm run
lint`, both builds and `docker compose build api worker`, and
`scripts/live-checks.sh` when it touches SQL.

---

#### T0 - Resend the first texts the EZ Texting block stopped

**Goal:** leads saved while EZ Texting was blocked (from 2026-10-14) get
question 1.
**Needs:** nothing. **Production:** nothing until Jeel runs the command, once
EZ Texting has unblocked the account.

**Build** (as built - `POLLER.md`, "Resending after an outage")
- A command, `npm run openers:send-waiting`, compiled into the image (not in
  `scripts/`, which production does not have).
- Arguments: `--from` and `--to` (when the leads arrived; a date without an
  offset is Arizona time), `--every` (default 30 seconds, never under 10),
  `--limit` (stop after this many texts), `--dry-run`.
- Which leads never got their first question is one definition,
  `db/openers-never-sent.ts`, moved out of the retry so the two share it.
  On top of it: **only leads the retry has given up on** (5 attempts used, or
  older than 24 hours), so the two never text the same lead; only leads in the
  window; and **only leads nobody has worked** - not picked up, no call,
  outcome, callback, note or agent text (added while building: days later, a
  lead a person dealt with must not get an automated first question).
- Each lead is checked again just before its text; sent with `sendOpener`,
  which also opens the reply window.
- **One text every 30 seconds**, never two at once; a skipped lead does not
  make the next one wait again.
- **Stops at the first refusal or unanswered request** from EZ Texting and
  prints which lead and how many were sent. Run again, it carries on: sent
  leads no longer match.
- One run at a time: an advisory lock held for the whole run.
- `--dry-run` sends nothing; it lists the leads, and separately any lead
  already expired without a first text (not sent - its conversation is over).
- Prints to the terminal only; each text is its `messages` row, as for every
  automated text.

**Done when**
- [x] A live check: picks only the leads the retry gave up on; skips a lead
      that replied, one a person worked, one with a text still `sending`, a
      blocked number, and one from before the window.
- [x] Run twice, no lead is texted twice.
- [x] Keeps the pace: one pause of `--every` between texts, none before the
      first.
- [x] Stops at a refusal, and carries on from there when run again; stops at
      an unanswered request and never sends that one again.
- [x] A lead that replies or is blocked while it runs is skipped.
- [x] A second run is refused while one is going.
- [x] The retry's own live check passes unchanged; all 16 live checks pass.
- [x] Jeel runs `--dry-run` on the server and checks the list before the real
      run - 2026-10-16: 174 leads, every one with 5 failed attempts, arrived
      Oct 14 3:23-5:32 AM and Oct 15 3:00-5:51 AM (Arizona time); then the
      real run, one text every 30 seconds.

**Files:** `backend/src/cli/send-waiting-openers.ts`,
`backend/src/worker/send-waiting-openers.ts`, `backend/src/core/resend-args.ts`
(+ test), `backend/src/db/openers-never-sent.ts`,
`backend/src/worker/retry-openers.ts`, `backend/package.json`,
`backend/scripts/send-waiting-openers-live-check.ts`.
**Doc:** `POLLER.md`, "Resending after an outage" (and the exception noted
under the retry's "never days late" rule); `LOGGING.md`, `AUDIT.md`,
`README.md`, `CLAUDE.md`.

---

### Setup

#### T1 - A laptop can never ring for production's calls

**Goal:** a browser signed in to a local app is never rung by production's
calls, even on the same Twilio account.
**Needs:** nothing. **Production:** none - the prefix is empty there.

**Build** (as built)
- A new optional setting, `TWILIO_IDENTITY_PREFIX` - lower-case letters and
  digits ending in a hyphen, for example `dev-`. Passed to the api and the
  worker by `docker-compose.yml`.
- The browser's name at Twilio becomes `<prefix>agent-<user id>`, in the
  token and in the incoming ring. Production leaves it empty, so its names
  stay `agent-<user id>`.
- Reading a name back (the voice webhook) accepts only this server's prefix,
  so a call from another environment's browser is never taken for one of ours.
- The prefix is a required argument of `identityFor` and
  `agentIdFromIdentity` - no default - so no caller can forget it and quietly
  use production's names.
- A malformed prefix makes the settings incomplete (production refuses to
  start), rather than being used or dropped.

**Done when**
- [x] Tests: no prefix gives `agent-21`, exactly as today; `dev-` gives
      `dev-agent-21` and reads back as user 21 - in the token, the incoming
      ring and the voice webhook.
- [x] Tests: a dev server refuses `agent-21`, and production refuses
      `dev-agent-21`.
- [x] Tests: a badly formed prefix is named as incomplete; a prefix alone
      does not switch calling on.
- [x] The local `.env` has `TWILIO_IDENTITY_PREFIX=dev-`.

**Files:** `backend/src/core/calls.ts`, `backend/src/twilio-settings.ts`,
`backend/src/integrations/twilio.ts`, `backend/src/api/twilio-webhooks.ts`,
their tests, `docker-compose.yml`, `.env.example`.
**Doc:** `TWILIO.md`, "What it needs on the Twilio account" and "Settings";
the settings table in `docs/README.md`; `CLAUDE.md` §7.

---

#### T2 - `twilio:configure` cannot move production's number

**Goal:** the configure command cannot take production's number or TwiML App
away from production by accident.
**Needs:** nothing. **Production:** running it on the server works as today.

**Build** (as built)
- One pure rule, `core/twilio-pointing.ts`, for the number **and the TwiML
  App** - the app had no check at all before, and was changed before the
  number was looked at.
- Refused without `--take-over`: this app on another real server (production,
  from a laptop), an address that is not this app, a number answered by
  another TwiML App. Pointing nowhere, at an old tunnel, or at the same server
  is not a refusal - so the recovery (run it on the server after an accident)
  still works.
- Both are decided before either is changed: a refusal changes nothing, never
  half-moves them.
- `--dry-run` says what it would change and changes nothing.

**Done when**
- [x] Tests: refuses production's number from a tunnel; allows a tunnel,
      nothing, the same server; `--take-over` overrides; someone else's line
      and another TwiML App are refused (21 tests).
- [x] On production's real settings, read only: from a laptop, the number and
      the app are both refused; on the server, nothing to change.
- [x] The real command, `--dry-run`, against the dev number: both would be
      pointed, nothing was changed (checked on Twilio afterwards).

**Files:** `backend/src/core/twilio-pointing.ts` (+ test),
`backend/src/cli/twilio-configure.ts`.
**Doc:** `TWILIO.md`, "What it needs on the Twilio account", "Settings" and
"Testing"; `WORKFLOW.md`; `CLAUDE.md` §4.

---

#### T3 - Set up the new number for local work

**Goal:** calls can be made and received locally on the new number, never on
(480) 470-8259.
**Needs:** T1, T2. **Production:** none.

**Build**
- **Done 2026-10-15:** the new number is **(480) 530-8582** (added by the
  client on 2026-10-14, voice and SMS, pointing nowhere). A TwiML App
  "secure-medical-calling-dev" was created, pointing nowhere. The local
  `.env` holds the new number and that app, with `PUBLIC_URL` empty - so
  calling stays off on the laptop - and production's number and app are no
  longer in it. The account id, token and API key are shared with production.
- **After T1:** `TWILIO_IDENTITY_PREFIX=dev-` in the local `.env`.
- **Done 2026-10-17:** checked the local `.env` held only the dev number, app
  and prefix; started a tunnel and set it as `PUBLIC_URL`; started the api
  alone - not the worker, so nothing polled EZ Texting or asked the questions
  (the api still sends the missed-call text: a third, unanswered test call
  texted Jeel's phone - `TWILIO.md`);
  `dev:twilio:configure -- --dry-run`, then for real: the dev app and the dev
  number now point at the tunnel. A local test lead with Jeel's phone (the
  local database only).

**Done when**
- [x] A real call from the local app reaches Jeel's phone, showing the new
      number - 2026-10-17, rang from (480) 530-8582; not picked up, saved
      `no_answer`, which is right.
- [x] A real call to the new number rings the local browser - only it, as
      `dev-agent-16`; answered, 6 seconds, recording saved.
- [x] Production untouched - its number and TwiML App read back on Twilio
      before and after, still pointing at dailyleadhub.com. (Checked on
      Twilio directly rather than on Admin > Overview, whose Calling check
      reads the same two settings.)

**Files:** none in the code.
**Doc:** `TWILIO.md` - local calling is allowed on the dev number only, how to
set it up, and these two calls.

---

### Data and rules - no calls yet

#### T4 - The database can hold a robot call

**Goal:** a call with no agent can be saved, and nothing mistakes it for an
agent's work.
**Needs:** nothing. **Production:** none - no robot calls exist yet.

**Build**
- Migration 014:
  - `calls.direction` also allows `automated`.
  - The rule "an outbound call has an agent" becomes `direction <> 'outbound'
    OR agent_id IS NOT NULL`, so a robot call may have none.
  - `calls.script_result`: `transferred`, `transfer_missed`, `link_sent`,
    `not_interested`, `opted_out`, `no_response`, `voicemail_left`,
    `hung_up`, `unanswered`.
  - A robot calls a lead only once: unique index on `calls (lead_id) WHERE
    direction = 'automated'`.
- Every rule that reads calls says which directions it means:
  - Working (`WORKED_SQL`): an agent's call, an answered incoming call, or a
    robot call an agent took.
  - Answering a missed call (`MISSED_CALL_SQL`): not a robot call, unless an
    agent took it.
  - "The last agent who called" for incoming calls: includes a robot call an
    agent took.
  - End of call, voicemail verdict, transcript speakers: handle `automated`.

**Done when**
- [x] A live check: a robot call with no agent leaves the lead not Working
      and a missed call still open - answered by the lead or under way.
- [x] A live check: once an agent takes it, the lead is Working, the missed
      call is answered, and a call back rings that agent.
- [x] The database refuses an agent's call without an agent, a second
      automated call to one lead, and a script result on any other call.
- [x] Every existing live check still passes - calls 104 (86 before), all 16.
- [x] The migration runs on the local database, which holds calls, and a
      second run applies nothing.

As built: one rule for both "Working" and "returned a missed call" - a call
counts when a person was on it (`agent_id` set), or an agent placed it; an
answered or ongoing call with nobody on it counts for neither. Existing rows
read exactly as before, since every answered or ongoing call so far has an
agent. The voicemail verdict is kept for automated calls too (T18 needs it),
and a transcript of one puts the lead on channel 1, as an incoming call does -
confirmed on a real transfer (T15a, 2026-10-20). `CallDirection` in
`core/calls.ts` is the one type for a call's direction.

**Files:** `backend/src/db/migrations/014_automated_calls.sql`,
`backend/src/db/lead-state.ts`, `backend/src/db/calls.ts`,
`backend/src/db/timeline.ts`, `backend/src/core/calls.ts`,
`backend/src/core/transcripts.ts` (+ test), `backend/src/db/transcripts.ts`,
`backend/scripts/calls-live-check.ts`.
**Doc:** `SCHEMA.md`, `TWILIO.md`, `ADMIN-LEADS.md`, `LEAD-FLOW.md`,
`WORKFLOW.md`, `CLAUDE.md` §5 and §10.

---

#### T5 - The screens know a robot call from an agent's call

**Goal:** nothing on screen counts a robot call as an agent's.
**Needs:** T4. **Production:** none.

**Build**
- The call direction type includes `automated`.
- "Calling back · you tried 2× today" counts only agents' calls.
- The timeline and the workspace conversation show a robot call as
  "Automated call", until T21 gives it its full wording.

**Done when**
- [x] Tests: a robot call is not counted in "you tried" - alone it gives no
      "Calling back" line; beside an agent's call, only the agent's counts.
- [x] Tests: a robot call shows on the timeline and in the conversation as
      "Automated call · answered · 40s", "· no answer", "· voicemail", "· in
      progress" - never as "Outbound call".
- [x] Tests: the Lead Timeline's "Attempts" counts it as one of ours, and it
      is not contact from the lead.

As built: `CallDirection` in `api/workspace.ts` mirrors the backend's.
"Attempts" keeps its rule - every call that is not the lead's - because a robot
call is our attempt to reach them. 299 frontend tests pass.

**Files:** `frontend/src/api/workspace.ts`, `frontend/src/lib/caller-context.ts`
(+ test), `frontend/src/components/Timeline.tsx` (+ test),
`frontend/src/pages/LeadTimelinePage.tsx` (+ test).
**Doc:** `FRONTEND.md`, `AGENT-WORKSPACE.md`, `TWILIO.md`.

---

#### T6 - The call script saved as rows

**Goal:** the script - every line and every accepted word - is in the
database, and there is a place to keep what each lead says.
**Needs:** T4. **Production:** none.

**Build**
- Migration 015:
  - `call_scripts` - one per script, only one active.
  - `call_steps` - the script's questions: key, position, the line, the
    repeat line.
  - `call_choices` - each answer: key (`1`, `2`), label, accepted words,
    the reply line, and either the next step or an ending (`transfer`,
    `send_link`, `declined`) - never both.
  - Stopping is the same on every question: "stop calling", "remove me",
    "do not call", or 9.
  - `call_answers` - one row per answer, never changed or deleted: the call,
    the lead, the step, what Twilio heard, how sure, the keys pressed, the
    choice matched (empty = not understood).
  - Seeded with the script in "The script" above.
  - Settings rows: call hours (11:00-17:00), time zone (America/Phoenix),
    days (Monday-Friday), wait after the first text (60 minutes), ring time
    (25 s), hold safety stop (10 minutes), confidence threshold (0.4). The
    texts - link text, voicemail, busy line, hold line - went on the script's
    row instead (see "As built" below).
- `db/call-script.ts` loads the active script.
- The link texted on "yes" is the one the SMS script already sends,
  https://www.edrugstore.com/anti-ez (Jeel, 2026-10-17).

**Done when**
- [x] The migration runs on the local database, and a second run applies
      nothing.
- [x] A live check: editing or deleting a `call_answers` row is refused; the
      same asking cannot be saved twice; a choice row must name its choice and
      nothing else may.
- [x] A live check: a choice with both a next step and an ending is refused,
      and one with neither; 9 as a choice; an unknown ending; a choice into
      another script; a second active script.
- [x] The loader returns the script exactly as written above - the opening
      line, the repeat line, both steps' choices, the stop words, the
      voicemail without email, the anti-ez link - and the eight settings.

As built - one change from the plan: **the script's own words are on its
`call_scripts` row, not in `settings`** - stop, no response, voicemail, busy,
hold, the link text and the voice. They are the script's words, in
eDrugstore's voice, and a script for another group brings its own. `settings`
keeps only the call center's numbers: hours, time zone, days, wait, ring
time, hold stop, confidence. The types are in `core/call-script.ts`, so the
pure rules of T7 and T8 need no database. `scripts/call-script-live-check.ts`,
29 checks; 17 live checks in all.

**Files:** `backend/src/db/migrations/015_call_script.sql`,
`backend/src/core/call-script.ts`, `backend/src/db/call-script.ts`,
`backend/scripts/call-script-live-check.ts`.
**Doc:** this one, `SCHEMA.md`, `AUDIT.md`, `README.md`, `WORKFLOW.md`,
`CLAUDE.md`.

---

#### T7 - Understanding a spoken answer

**Goal:** a spoken or keyed answer becomes yes, no, stop, or "not
understood" - never a guess.
**Needs:** T6. **Production:** none.

**Build**
- `matchSpokenChoice` - pure, no database. Takes what Twilio heard, the keys
  pressed, how sure Twilio was, and the question's choices.
- A key wins: 1, 2, or 9 for stop.
- Stop words win over every other answer.
- Otherwise each choice's words are looked for as whole words inside the
  sentence, longest first ("not interested" before "interested"). Exactly one
  choice found -> that choice. None or two -> not understood.
- Twilio less sure than the threshold -> not understood. No figure at all, or
  0 -> not counted against it.
- SMS matching (`matchChoice`) is not changed.

**Done when**
- [x] Tests: "Yes, I am", "Yeah sure", "yes please" -> Yes; and on the link
      step "Sure, send it", "text me" -> Yes, "Don't text me" -> No.
- [x] Tests: "No", "No, I'm not interested", "not interested" -> No - never
      Yes for the "interested" inside it.
- [x] Tests: "Stop calling me", "remove me", "do not call", key 9, "nine" ->
      stop; it wins over anything else said, and when Twilio is unsure.
- [x] Tests: "yes no", "maybe", "what is this", "not really interested" ->
      not understood; nothing said or pressed -> silence.
- [x] Tests: keys 1 and 2 win over anything heard; another key is not
      understood; "one", "to", "won" said alone count as keys; "yes" heard
      with 0.21 -> not understood, at 0.4 -> Yes, with no figure or 0 -> Yes.
- [x] Every SMS matching test still passes - 65 answer tests in all.

As built: the tests use `core/call-script-fixtures.ts`, the script as
migration 015 seeds it (and, since, 018 changes it), and `call-script-live-check.ts` compares that copy with
the database word for word, so the tests always use the real words. Sound-alike
number words ("to", "won") were added while building - the repeat line asks for
keys, and some people say the number instead.

**Files:** `backend/src/core/answers.ts`, `backend/src/core/answers.spoken.test.ts`,
`backend/src/core/call-script-fixtures.ts`, `backend/scripts/call-script-live-check.ts`.
**Doc:** this one, "Understanding an answer"; `CLAUDE.md` §4.

---

#### T8 - What the robot does after each answer

**Goal:** the whole script's logic is one pure function, tested on its own.
**Needs:** T6, T7. **Production:** none.

**Build**
- `core/call-script.ts`: given the script, the question, whether it is the
  first or second try, and the answer, it returns what to say and what comes
  next - ask the next question, ask again, transfer, send the link, or end
  with a result.
- Not understood, first time -> the repeat line ("Press 1 for yes, 2 for no,
  or 9 to stop these calls."); second time -> "Thank you for your time. Have a
  great day." and `no_response`. Silence counts as not understood.
- Stop -> "Okay, we will not call you again. Goodbye.", `opted_out`, and the
  number to be blocked.
- A choice -> its reply line, then its next question or its ending.
- A script that points at a question that does not exist ends the call
  politely, never loops.

**Done when**
- [x] A test for each path: Q1 yes -> transfer; Q1 no -> Q2, said with the
      reply; Q2 yes -> link; Q2 no -> not interested; not understood once and
      twice; silence once and twice; stop on Q1 and Q2, on either asking; an
      answer on the second asking; a broken script four ways (an unknown step,
      a missing next step, a step leading back, no steps) - 22 tests.

As built: `CallAction` is what the webhooks carry out - ask a step (with the
lines to say and which asking it is), transfer, or end with a `CallResult`
(the `script_result` values) and flags: send the link, block the number, or a
broken script to log. `answerRecord` gives the `call_answers` row for an
answer. 757 backend tests pass.

**Files:** `backend/src/core/call-script.ts`, `backend/src/core/call-script.test.ts`.
**Doc:** this one, "What the call does after each answer"; `CLAUDE.md` §4.

---

### Who can take a call

#### T9 - The server knows who is online

**Goal:** the server knows whose app is open and able to ring, within 2
minutes.
**Needs:** nothing. **Production:** the browser starts reporting; nothing
visible.

**Build**
- Migration 016: `users.ringable_until`.
- `POST /api/calls/ringable` (signed-in users), saying whether this browser
  can take a call now: registered with Twilio, and no call, ring or
  after-call note open. Sets `ringable_until` to 2 minutes from now, or
  clears it.
- The browser sends it from its existing 30-second check (`keepRegistered`),
  and at once when a call, a ring or a note box starts or ends.
- Signing out and deactivating an account clear it.

**Done when**
- [x] Route tests: signed-in only; available and busy both saved for the
      signed-in person; anything but true or false refused; refused with
      calling off.
- [x] A live check: available for 2 minutes, and again from the start when
      said again; busy (cleared); silent for 2 minutes (gone); signed out
      (cleared, nobody else's); deactivated (cleared, and never ringable
      again) - 17 checks.
- [x] Frontend tests: "not available" while the Twilio connection is down; at
      once when a call starts and when it is done; every 30 seconds; in
      order; nothing after signing out. Which call states keep the agent busy;
      an incoming ring keeps the browser busy until its note box is done, a
      missed call does not - 316 frontend tests.
- [x] Seen against Twilio, from the local app with calling switched on for the
      check (the dev number's settings, `dev-` names, nothing pointed): signed
      in -> "available", held 120 seconds, said again at 30 seconds; signed
      out -> cleared; no console errors.

As built: one change from the ticket - **when Twilio cannot be reached the
browser says "not available"** rather than nothing, so the server knows within
half a minute, not two. What keeps a browser busy is one small register,
`lib/presence.ts`, marked by the lead's call (`useLeadCall`) and the incoming
call (`lib/incoming-call.ts`); the rules are `occupiesAgent` and
`incomingOccupiesAgent`, pure. Reports go one after another, so an older
"available" never lands after a newer "busy". Nothing is said when the app
stops listening: signing out has already cleared it on the server, and a word
then could only be refused. Ending a session clears it in `db/users.ts`, the
one place every session ends - sign-out, deactivation, a password change -
so `api/auth/routes.ts` is unchanged. Not in the activity log. Nothing reads it
yet: T10 joins it to the switch.

**Files:** `backend/src/db/migrations/016_presence.sql`, `backend/src/db/presence.ts`,
`backend/src/db/users.ts`, `backend/src/api/calls.ts` (+ test),
`backend/scripts/presence-live-check.ts`, `frontend/src/lib/presence.ts` (+ test),
`frontend/src/lib/calling.ts` (+ test), `frontend/src/lib/call-state.ts` (+ test),
`frontend/src/lib/incoming-state.ts` (+ test), `frontend/src/lib/incoming-call.ts`
(+ `layout/IncomingCall.test.tsx`),
`frontend/src/pages/workspace/useLeadCall.ts`, `frontend/src/api/calls.ts`.
**Doc:** this one, "Who is free"; `TWILIO.md`, `SCHEMA.md`, `AUDIT.md`,
`AUTH.md`, `FRONTEND.md`, `README.md`, `WORKFLOW.md`, `CLAUDE.md`.

---

#### T10 - The "Taking calls" switch

**Goal:** only people who switched "Taking calls" on are rung for transfers
or counted as free.
**Needs:** T9. **Production:** none - the switch shows only when `AUTO_CALLS`
is on.

**Build**
- Migration 017: `users.taking_calls` (off by default) and `taking_calls_at`.
- `POST /api/calls/taking-calls` to switch it on or off.
- Off at every sign-in and every sign-out.
- Every change is recorded: `calls.availability_changed`, with on/off and
  why (`by_hand`, `sign_in`, `sign_out`, and later `missed_transfer`).
- The switch in the app bar, beside the user menu, in the app's style.
- `GET /api/calls/config` says whether `AUTO_CALLS` is on;
  `docker-compose.yml` passes `AUTO_CALLS` to the api and the worker.
- One shared definition of **free** (`FREE_SQL`): active, switch on, app open,
  not on a call. Used by every later ticket.

**Done when**
- [x] Tests: off after sign-in and sign-out; on and off by hand; every change
      in the activity log, and nothing that did not change; refused with
      automated calls off, and anything but true or false refused - 13 route
      tests; `AUTO_CALLS` read only as exactly `on` - 8 tests.
- [x] A live check: switch off -> not free; on but on a call -> not free; on,
      app open, not on a call -> free, superadmin or agent. Also: a browser
      silent or busy, a lead ringing them, a call never reported ended, an
      automated call before and after its transfer is taken, a deactivated
      account; the time it changed kept only on a change - presence check,
      34 checks.
- [x] The switch is hidden with `AUTO_CALLS` off - tested, and seen.
- [x] Seen in the local app with calling and automated calls on for the check
      (dev settings): off after sign-in; switched on -> saved, and free once
      the browser registered with Twilio; still on after a reload; signing out
      -> off, not free; recorded `by_hand`, then `sign_out`; no console
      errors.

As built: `AUTO_CALLS` is read by `auto-calls-settings.ts` - on only when it
says exactly `on`; `off` or empty is off, and any other value is off and
logged once (`auto_calls.off`) - never a reason to refuse to start. Automated calls count as on only with
calling set up too, decided once in `api/index.ts` (`deps.autoCalls`). The
switch lives on the user (`takingCalls` on the signed-in user), so the app
bar reads it from the sign-in store. It flips only once the server has it.
The rule is `FREE_SQL`, with `freePeople`, and migration 017 also adds
`calls_under_way_by_agent`, a small index of the calls still going.

**Files:** `backend/src/db/migrations/017_taking_calls.sql`,
`backend/src/auto-calls-settings.ts` (+ test), `backend/src/api/taking-calls.ts`,
`backend/src/api/calls.ts`, `backend/src/api/auth/routes.ts`,
`backend/src/api/deps.ts`, `backend/src/api/index.ts`,
`backend/src/api/users/types.ts`, `backend/src/db/users.ts`,
`backend/src/db/presence.ts`, `backend/src/core/activity.ts`,
`backend/src/api/__tests__/taking-calls.test.ts`,
`backend/scripts/presence-live-check.ts`, `frontend/src/layout/TakingCalls.tsx`
(+ test), `frontend/src/layout/AppShell.tsx`, `frontend/src/api/calls.ts`,
`frontend/src/api/types.ts`, `frontend/src/styles/shell.css`,
`docker-compose.yml`, `.env.example`.
**Doc:** this one, `AUDIT.md`, `AUTH.md`, `SCHEMA.md`, `FRONTEND.md`,
`LOGGING.md`, `README.md`, `WORKFLOW.md`, `CLAUDE.md`.

---

#### T11 - Several browsers ringing at once

**Goal:** when a call rings several people, the ones who did not take it see
nothing odd, and nobody loses an unsaved note.
**Needs:** nothing. **Production:** none - nothing rings several people yet.

**Build**
- A call that rings several people carries `ring=group`; a transfer also
  carries `reason=transfer`.
- Someone else accepted it -> the card clears quietly, with no "Missed call"
  notice.
- A ring that arrives while an after-call note is open is not shown; the note
  stays.
- A transfer's card reads "Transfer · said yes to the offer", without the
  "Calling back" line.
- A call that rings one person behaves exactly as today.

**Done when**
- [x] Tests: a group ring taken by someone else -> nothing shown, no "Missed
      call", the ring stops.
- [x] Tests: a one-person ring not answered -> "Missed call", as today.
- [x] Tests: a group ring while the note is open -> declined, and the note
      kept as typed; the same while a call or note from a lead's page is open.
      A one-person ring still takes the note box's place, as today.
- [x] Tests: the transfer card's wording, with no "Calling back" line; the
      ring's kind read from the call - 339 frontend tests.
- [x] Seen in the local app, the card's state set in the page (nothing rang):
      a transfer reads "Transfer · said yes to the offer"; an ordinary call
      back keeps its "Calling back" line; no console errors.

As built: a ring is marked with `<Parameter>`s - `ring=group`,
`reason=transfer`, and `step`, the heading of the question the lead said yes
to - which the server sends for a transfer since T15a, and will for a call
back with T19; the card's words come from the script's rows: "said yes to the offer"
from the step "Offer" (`transferContext`). `ringKind` in `lib/calling.ts`
reads them; each ring carries its `RingKind` through `lib/incoming-state.ts`.
A group ring arriving while anything keeps the browser busy - including a
call or note on a lead's page, which the incoming store cannot see - is
**declined** rather than ignored (`lib/presence.ts`, from T9): Twilio keeps
ringing the others, and the whole ring is busy only when every browser was
("Busy Everywhere", error 31600) - one browser declining was confirmed to
leave the other ringing on the first real group ring (T15a, 2026-10-20). A one-person ring is unchanged, including taking an open note
box's place: it is that agent's own lead calling.

**Files:** `frontend/src/lib/incoming-state.ts` (+ test), `frontend/src/lib/incoming-call.ts`,
`frontend/src/lib/calling.ts` (+ tests), `frontend/src/lib/caller-context.ts` (+ test),
`frontend/src/layout/IncomingCall.tsx` (+ test).
**Doc:** `FRONTEND.md`, `TWILIO.md` ("A ring that goes to several people"), `CLAUDE.md`.

---

### The call - on the dev number

#### T12 - The server places one call

**Goal:** the server can call a phone, say question 1, and save how the call
ended.
**Needs:** T3, T4, T6. **Production:** none.

**Build**
- `integrations/twilio-calls.ts` - the only file that places calls through
  Twilio's REST API, with voicemail detection switched on (for T18) and a
  time limit on the request.
- `npm run dev:auto-call -- <phone>` places one call to a lead with that
  number. It refuses in production.
- **Outside production, only numbers in `AUTO_CALL_TEST_NUMBERS` are ever
  called** - by this command and later by the robot.
- Placing a call: lock the lead, check it is not blocked, save the `calls`
  row (`automated`) and `call.started` in one transaction, then ask Twilio.
  Twilio refuses -> saved as `failed`. No answer from Twilio in time -> left
  as it is (the call may have gone out).
- `POST /api/webhooks/twilio/auto/answer` - says question 1 and listens (keys
  and speech). Fills in Twilio's call id if it was not saved.
- `POST /api/webhooks/twilio/auto/status` - saves the end: outcome, length,
  end time, `call.ended`.
- Both routes: refused without Twilio's signature (403), not found with
  calling off (404), kept in `webhook_events`.

**Done when**
- [x] Route tests: signed, unsigned, signed for another row, calling off,
      automated calls off, the end saved, the verdict kept, a request naming
      no row or another call's - 17 tests.
- [x] Jeel's phone rings showing the new number and hears question 1 -
      2026-10-18, call 4, placed from (480) 530-8582 with `dev:auto-call`.
- [x] The row is saved with its outcome and length - answered, 13 seconds, no
      agent; the four webhooks arrived in order (answer, amd, gather, status)
      and the activity log has `call.started`, `call.answered_by` and
      `call.ended`, all the system's.
- [x] A number not on the list is refused - tested, and proved on a real
      database with every other refusal, linking, failing and two placements
      racing for one lead (`auto-calls-live-check`, 34 checks).

As built: "How a call is placed", above. The steps are one path,
`worker/place-auto-call.ts`, which the dialler will use. The webhooks name
our row (`?call=<id>`), not Twilio's call, because the row exists before
Twilio answers. The voicemail verdict already has its webhook,
`/auto/amd`, which keeps it as for an agent's call; T18 adds the message. Until
T13, `/auto/gather` thanks the lead and ends the call, whatever was said -
without it, the first answer would reach no webhook and the lead would hear
Twilio's error. All four answer 404 while `AUTO_CALLS` is off, so production
has none of them until it is switched on.

The first real call taught three things. **Twilio still asks `/auto/gather`
after the lead hangs up**, with `CallStatus=completed` and nothing heard - T13
must take that as hung up, never as silence to ask again. **Voicemail
detection said `unknown` for a person** who listened - T18 carries on for
`unknown`, as planned. And Jeel asked for **no "This is an automated call"
line, the offer before the question, and a more natural voice**: migration
018, after a sample call of five newer voices - "The script". Each of its changes names the value it
replaces and must change exactly the rows it expects, or the migration stops.
(T13 then added the stop and repeat lines to 018: four guarded changes in all,
over three of 015's rows.)

**Files:** `backend/src/integrations/twilio-calls.ts` (+ test),
`backend/src/integrations/twilio.ts` (the TwiML, + test), `backend/src/api/twilio-webhooks.ts`,
`backend/src/api/__tests__/auto-call-webhooks.test.ts`, `backend/src/db/auto-calls.ts`,
`backend/src/worker/place-auto-call.ts` (+ test), `backend/src/auto-calls-settings.ts`
(+ test), `backend/src/core/call-script.ts`, `backend/scripts/dev-auto-call.ts`,
`backend/scripts/dev-phone.ts`, `backend/scripts/auto-calls-live-check.ts`,
`backend/package.json`, `docker-compose.yml`, `.env.example`; and for the
opening and the voice, `backend/src/db/migrations/018_call_opening_and_voice.sql`,
`backend/src/core/call-script-fixtures.ts`, `backend/scripts/call-script-live-check.ts`.
**Doc:** this one, "How a call is placed"; `TWILIO.md`, `AUDIT.md`,
`LOGGING.md`, `README.md`, `CLAUDE.md`.

---

#### T13 - The questions

**Goal:** a call goes through the whole script: answers, asking again, no
response, not interested, and stop.
**Needs:** T7, T8, T12. **Production:** none.

**Build**
- `POST /api/webhooks/twilio/auto/gather` - reads what Twilio heard, the keys
  and how sure it was; asks T7 what it means and T8 what to do; says it.
- One `call_answers` row per answer. Twilio sending the same request twice
  saves one row.
- The result is saved once (`script_result`, only if still empty); and when
  the call ends without one (`/auto/status`, T12): `unanswered` if it was
  never answered, `hung_up` if the script never finished.
- Replaces T12's stand-in on `/auto/gather`, which thanks the lead and ends
  the call whatever was said.
- A request with `CallStatus=completed` is a lead who hung up - found on the
  first real call: Twilio still asks `/auto/gather` after the hang-up, with
  nothing heard. Saved as `hung_up`, never taken as silence to ask again.
- Testing needs several real calls to one phone, and locally that phone can
  have only one: one lead per number (`leads_phone_key`) and one automated
  call per lead. A dev-only way to call again is needed first - decided here,
  never touching the production path's rules. Noted 2026-10-18.
- Stop -> the number is blocked (`blockNumber`, new reason `call_opt_out`),
  recorded in the activity log.
- The first question cannot be interrupted, so "Hello?" is not an answer.
  (As built: the greeting cannot be; the question itself can - "When the
  call listens".)
- A "yes" ends the call politely until T15a builds the transfer. (As built:
  the busy line, `transfer_missed`.)

**Done when**
- [x] Route tests for each path, and for the same request twice - 27 webhook
      tests; every path and every hang-up case of `handleAnswer`; the
      listening split. A live check proves the SQL: one answer per asking, a
      result never overwritten, a stop blocking once, the end settling an
      unfinished script (`auto-calls-live-check`, 54 checks).
- [x] Real calls, 2026-10-19, to Jeel's phone: yes -> the busy line; no ->
      Q2 -> "no thanks" -> not interested; silence twice -> no response; keys
      2 -> 1 -> link sent; 9 -> blocked, and a call to the blocked number then
      refused; "stop calling me" -> blocked.
- [x] Each answer is in `call_answers` with what was heard, how sure, and the
      keys.

As built: the rules are pure - `handleAnswer` in `core/call-script.ts`, on
top of T7 and T8 - and `keepAnswer` keeps an answer, its result and any
block in one transaction, each part safe to repeat. The real calls changed
three things. **Answers said over the end of a question were lost** - T12's
`<Gather>` did not listen while it spoke - so the greeting is now said with
nothing listening and the question itself with listening on
(`splitForListening`). **Kore's "won't" sounded like "will"** in "we won't
call you again", the line after a stop: "won't" and "didn't" are written out
in migration 018. And **a spoken answer takes about 4-5 seconds** to come
back against a key's instant one; Twilio's short-answer model, tried, was no
faster and far less sure, so it was dropped - T13b then halved Twilio's part
with Deepgram. A "yes" hears the busy
line until T15a. The link is saved as asked for, and texted since T14. `dev:auto-call`
gained `--again` and `--unblock` for testing with one phone. The DNC page
names the new reason, "Said stop on automated call". Found in the doc check
the same day: a stop on the call blocked the number but left the text
conversation open, unlike a STOP text or an agent's DNC - it now ends it too
(`keepAnswer`; `auto-calls-live-check`, 56 checks).

**Files:** `backend/src/core/call-script.ts` (+ test), `backend/src/api/twilio-webhooks.ts`,
`backend/src/api/__tests__/auto-call-webhooks.test.ts`, `backend/src/db/auto-calls.ts`,
`backend/src/db/call-script.ts`, `backend/src/db/dnc.ts`, `backend/src/integrations/twilio.ts`
(+ test), `backend/src/core/call-script-fixtures.ts`,
`backend/src/db/migrations/018_call_opening_and_voice.sql`, `backend/scripts/dev-auto-call.ts`,
`backend/scripts/auto-calls-live-check.ts`, `backend/scripts/call-script-live-check.ts`,
`frontend/src/pages/admin/DncPage.tsx`.
**Doc:** this one ("Understanding an answer", "What the call does after each
answer", "How a call is placed"), `AUDIT.md`, `SCHEMA.md`, `LOGGING.md`,
`README.md`, `CLAUDE.md`.

---

#### T13b - Spoken answers understood faster

**Goal:** after a lead speaks, the call goes on about as fast as after a key.
**Needs:** T13. **Production:** none.

**Build**
- Found on T13's real calls (2026-10-19): about 4-5 seconds between a spoken
  answer and the call going on; a key press is near-instant. Our server
  answers Twilio in about 0.2 seconds (Twilio's own request log), so the time
  is Twilio deciding the lead has stopped and working out the words - not
  making the voice, since after a key the reply starts at once.
- Measure first: record one test call, both sides, and find in the audio when
  the lead stopped speaking and when the reply started - the gap, in tenths
  of a second.
- Then try, one at a time and measured the same way: `speechTimeout` in
  whole seconds with Twilio's own model; a provider's own model - Google's
  `googlev2_telephony_short`, Deepgram's `deepgram_nova-3` - which Twilio does
  not fail over in an outage. Already tried: `experimental_utterances` - no
  faster, and a clear "yes" at 0.24 and 0.00.
- Keep the fastest that hears "yes", "no" and "stop calling me" as surely as
  now (0.5 to 0.95).
- Jeel's call, not a must: the questions could invite keys ("…Say yes, or
  press 1."), which are instant and never misheard.

**Done when**
- [x] The gap measured on a recorded call, before and after - 4.0-4.3 s of
      silence before, 2.4-3.3 s after; Twilio's part 3.3 s before, 1.6-1.7 s
      after.
- [x] The chosen setting no less sure of yes, no and stop on real calls -
      "no" 0.97, "no thank you" 0.999, "stop calling me" 0.998, "yes" 0.53
      (0.61 before).
- [x] Jeel hears the difference on his phone - six recorded calls,
      2026-10-19.

As built: "Understanding an answer", "How fast". Three settings were measured
on recorded calls and Deepgram's `nova-3` with a one-second end was kept. A
fixed one-second end on Twilio's own model was faster on a quiet line but
slower than before when a noise restarted its wait. Not done: the reply's
voice still takes 0.8-1.5 s to start, and a question's lead-in and the
question itself have about 0.9 s between them - audio made once would shrink
both, a separate change if wanted. Inviting keys in the questions was not
needed.

**Files:** `backend/src/integrations/twilio.ts` (+ test).
**Doc:** this one, "Understanding an answer".

---

#### T14 - Text the link

**Goal:** "yes" to question 2 texts the link, exactly once.
**Needs:** T13. **Production:** none.

**Build**
- The missed-call text sender becomes a general "send this text to this
  lead", given the text - the link text from the script's row
  (`call_scripts.link_text`, T6), the missed-call text from `settings` as
  today; the missed-call text works unchanged.
- On "yes": save `link_sent` first (only if the result is still empty); only
  then send the text, after Twilio has its answer.
- The text is saved in `messages` like every text; a blocked number gets
  none.

**Done when**
- [x] Tests: the same request twice -> one text; a yes said as the lead hung
      up -> texted; Twilio answered without waiting on the text; no to the
      link -> none.
- [x] Tests: a blocked number -> no text, nothing on the thread
      (`lead-texts-live-check`, 15 checks, EZ Texting stubbed below its
      do-not-call check).
- [x] The missed-call text tests still pass - and it now has its own live
      checks, which it never had.
- [x] A real call: the link arrives on Jeel's phone - 2026-10-19, call 19:
      "No." 0.76, "Yes." 0.93, sent once, on the lead's thread.

As built: `db/missed-call-text.ts` became `db/lead-texts.ts` - one sender
for both texts, each reading its words (the settings row, the active script's
`link_text`); a missing one is `sms.no_template`. The link goes out only for
the request that kept the answer (`keepAnswer`'s `kept`, which now also names
the call's lead), after the response to Twilio; `link_sent` is saved in the
same transaction as the answer, before the text.

**Files:** `backend/src/db/lead-texts.ts` (was `missed-call-text.ts`),
`backend/src/db/auto-calls.ts`, `backend/src/api/twilio-webhooks.ts`,
`backend/src/api/__tests__/auto-call-webhooks.test.ts`,
`backend/src/api/__tests__/calls.test.ts`, `backend/scripts/lead-texts-live-check.ts`,
`backend/scripts/auto-calls-live-check.ts`.
**Doc:** this one, "On a live call"; `TWILIO.md`, `POLLER.md`,
`STATE-MACHINE.md`, `LOGGING.md`, `AUDIT.md`, `README.md`, `CLAUDE.md`.

---

T15 was split in three on 2026-10-20, before it was started, so each part is
one small PR with its own real-call checks: everyone free rings (T15a), the
lead's own agent first (T15b), and letting a ring run out turns the switch off
(T15c).

#### T15a - The transfer: everyone free

**Goal:** a "yes" reaches a person: everyone free rings, and the first to
accept has the lead.
**Needs:** T10, T11, T13. **Production:** none.

**Build**
- On "yes" (never when the call is a machine): "Great, connecting you with a
  live agent now. Please hold.", then the recording notice.
- Ring everyone free (at most 10) together for 25 seconds, carrying the lead
  and `ring=group`, `reason=transfer` and `step` - the heading of the
  question the lead said yes to (T11, `TWILIO.md`). No per-person end
  reports - the end is taken from the call itself.
- The first to accept: `POST .../auto/claim` makes them the lead's holder
  (taking over from anyone else, recorded with who it was taken from), saves
  them on the call, and the result `transferred`.
- Nobody accepts -> the busy line, `transfer_missed` (T16 adds the hold line
  before it). Nobody free -> the busy line at once.
- Recording starts when the agent joins, as on every other call.
- Confirm on the first real group ring that one browser declining leaves the
  others ringing (T11 relies on it), and that the lead is on channel 1 of the
  recording (T4 assumed it).

**Done when**
- [x] Tests: `planTransfer` - people free, more than 10, nobody, a machine;
      `transferTwiml` - the lines, the notice only on a recorded call, one ring
      per person with this server's names and the lead, the ring time; the
      webhooks - both new ones 404 while off and 403 unsigned; free people
      rung, nobody free, a machine, a yes as the lead hung up, a person
      accepting, refused, a leg of another call, another server's browser
      name, the database failing, the ringing over taken and not taken in four
      ways ("the transfer (T15a)", 46 webhook tests).
- [x] A live check of `takeTransfer`: taking over from the lead's holder; the
      same request again; a second person refused; a lead nobody held; the
      browser's own pick-up first - no second pick-up, the transfer still
      recorded; a deactivated account refused; no such call; and
      `missTransfer` never overwriting a result (`auto-calls-live-check`, 76
      checks).
- [x] Two browsers, a real call: A accepts -> A holds the lead, the call is A's
      and `transferred`, the recording saved - 2026-10-20, calls 20 and 22.
- [x] Nobody accepts -> both rang, the busy line, `transfer_missed`, nobody
      holds the lead - call 21.
- [x] B declines -> A keeps ringing, and takes it - call 22.
- [x] B on a call -> B is not rung: a transfer rings only `freePeople`, and
      `FREE_SQL` leaves out anyone on a call (T10, `presence-live-check`).
- [x] The lead on channel 1: different words said on each side, each under its
      speaker in the transcript - call 23.

As built: "The transfer". One addition: **`call.transferred`**, a new action -
the first real transfer was taken in a browser whose own pick-up of the lead
reached the server first, so `lead.picked_up` was the browser's and nothing
recorded that a transfer had been taken. A yes from a machine, if Twilio's
verdict has come, rings nobody and ends as `no_response`. The ring time is
the `auto_call_ring_seconds` row, read on every transfer (`readRingSeconds`).

**Files:** `backend/src/core/call-script.ts` (+ test),
`backend/src/integrations/twilio.ts` (+ test), `backend/src/api/twilio-webhooks.ts`,
`backend/src/api/__tests__/auto-call-webhooks.test.ts`, `backend/src/db/auto-calls.ts`,
`backend/src/db/call-script.ts`, `backend/src/core/activity.ts`,
`backend/scripts/auto-calls-live-check.ts`.
**Doc:** this one, "The transfer"; `TWILIO.md`, `AUDIT.md`, `LOGGING.md`,
`README.md`, `CLAUDE.md`.

---

#### T15b - The transfer: the lead's own agent first

**Goal:** a lead who said yes reaches the agent who already has them, when
that agent is free.
**Needs:** T15a. **Production:** none.

**Build**
- The lead is held by someone free -> ring only them, 25 seconds. (As built:
  marked `ring=group` all the same - below.)
- Not taken in 25 seconds -> everyone else free, as in T15a - not the holder
  who just let it ring. Whoever takes it holds the lead.
- The lead held by someone not free -> straight to everyone free.

**Done when**
- [x] Tests: holder free -> rung alone first (also beyond the first ten free);
      holder not free -> everyone free at once; not taken, or declined ->
      everyone else free, with nothing said and no notice again; nobody else
      free -> the busy line; the lead hung up while it rang -> nobody further
      rung; taken -> nothing more (`planTransfer`, `planAfterHolder`,
      `transferTwiml`, 53 webhook tests). A live check: the lead's holder in
      what a transfer reads, and none for a lead nobody holds
      (`auto-calls-live-check`, 77 checks).
- [x] Two browsers, a real call: lead held by A, A free -> only A rings; A
      does not take it -> B rings - 2026-10-20, call 25 (each rang its full
      time; Twilio's own log of the two rings).
- [x] Lead held by A, A not free - switch off (the same rule as on a call,
      `FREE_SQL`) -> only B rings, at once - call 26; B taking it takes the
      lead from A (`tookOverFrom`) - call 24.

As built: the lead's own agent's ring is marked **`ring=group`**, though they
ring alone - decided while building. The ring goes on without them if they
do not take it, which is what the browser's shared-ring rules are for: it
clears with no "Missed call" notice, and it is declined at once if they are
busy, so an open note box is never replaced. Unmarked, it would have been a
lead's own call to them, showing "Missed call" while a colleague talked to the
lead. The browser is unchanged. `/auto/after` is told who was rung alone
(`holder`) and the step, both in the address Twilio signs; a reload of the
ringing window counts as declining, and moves on too. The real calls also
showed Twilio's voicemail detection calling a person a machine - for T18,
"The transfer".

**Files:** `backend/src/core/call-script.ts` (+ test),
`backend/src/integrations/twilio.ts` (+ test), `backend/src/api/twilio-webhooks.ts`,
`backend/src/api/__tests__/auto-call-webhooks.test.ts`, `backend/src/db/auto-calls.ts`,
`backend/scripts/auto-calls-live-check.ts`, `frontend/src/lib/incoming-state.ts`,
`frontend/src/lib/calling.ts` (comments only).
**Doc:** this one, "The transfer"; `TWILIO.md`, `FRONTEND.md`, `LOGGING.md`,
`README.md`, `CLAUDE.md`.

---

#### T15c - Letting a transfer ring out turns the switch off

**Goal:** a desk left with "Taking calls" on stops being rung after one
missed transfer, and its screen says so.
**Needs:** T15a. **Production:** none.

**Build**
- A free person who let a transfer ring out, and is still free, has their
  switch turned off and sees "Missed a transfer · Taking calls off". Someone
  who started a call in those seconds keeps it on.
- Who was rung is known only to the call: keep it, so `/auto/after` can turn
  off exactly those people.
- The browser must learn that: its switch shows what the server holds (T10),
  and today it reads it only at sign-in and when switched. One way: the
  30-second report (T9) answers with the switch's state. The switch-off is a
  `calls.availability_changed` row with `why: missed_transfer`, written in the
  same statement. Noted 2026-10-18.

**Done when**
- [ ] A live check: rung and still free -> off, recorded `missed_transfer`;
      on a call by then -> still on; someone else took it -> nobody's switch
      changes.
- [ ] Two browsers, a real call nobody takes: both switches off, both screens
      say so within 30 seconds.
- [ ] B on a call -> B is not rung, and B's switch stays on.

**Files:** `backend/src/api/twilio-webhooks.ts`, `backend/src/db/auto-calls.ts`,
`backend/src/db/presence.ts`, `backend/src/api/calls.ts`,
`frontend/src/layout/TakingCalls.tsx`, `frontend/src/lib/calling.ts`.
**Doc:** this one, "Who is free"; `AUDIT.md`.

---

#### T16 - The hold line

**Goal:** a "yes" that nobody took waits on hold when someone will be free
soon, and is never kept waiting for nobody.
**Needs:** T15a. **Production:** none.

**Build**
- Nobody took it, and someone is on a call -> on hold: "All our agents are on
  other calls. Please stay on the line." then the lead's place: "You are
  next." / "You are number 2 in line.", then hold music.
- About every 30 seconds it checks again:
  - someone still on a call -> keep waiting, say the place again;
  - nobody on a call -> the busy line;
  - waited 10 minutes -> the busy line (safety stop).
- Nobody took it, and nobody is on a call -> the busy line at once.
- While anyone is on hold, the robot places no new calls (used by T20).

**Done when**
- [ ] A real call on hold hears "You are next" and the music.
- [ ] The other call ends without taking it -> the busy line within 30 s.
- [ ] The safety stop works (tested with a short setting).
- [ ] "Is anyone on hold" is correct while waiting and after.

**Files:** `backend/src/api/twilio-webhooks.ts`, `backend/src/integrations/twilio.ts`,
`backend/src/db/auto-calls.ts`.
**Doc:** this one.

---

#### T17 - The next free person gets the waiting lead

**Goal:** someone finishing a call is offered the lead on hold before
anything else.
**Needs:** T16. **Production:** none.

**Build**
- When someone becomes free - their call has ended and their note is saved or
  skipped - and a lead is on hold, the oldest waiting lead rings them alone
  for 20 seconds.
- They accept -> as in T15a. They do not -> the lead goes back on hold, and
  their switch turns off as in T15c.

**Done when**
- [ ] Two browsers: A on a call, the lead on hold, A ends and saves the note
      -> A's browser rings with the lead -> A accepts and holds it.
- [ ] A skips the note instead -> the same.
- [ ] A does not accept -> the lead is back on hold.

**Files:** `backend/src/api/calls.ts`, `backend/src/api/twilio-webhooks.ts`,
`backend/src/db/auto-calls.ts`.
**Doc:** this one.

---

#### T18 - Voicemail

**Goal:** a voicemail gets the message after the beep, and a machine is never
transferred.
**Needs:** T12. **Production:** none.

**Build**
- `POST .../auto/amd` - Twilio's verdict on who answered (the webhook exists
  since T12 and keeps the verdict). A machine, once its greeting ends -> the
  call switches to the voicemail message (the number read out digit by
  digit), then hangs up; result `voicemail_left`.
- A fax -> hang up. A person, or not sure -> the script carries on.
- The verdict is saved as `answered_by`, as for agents' calls.
- A verdict that arrives while a transfer is ringing stops it and leaves the
  message.
- **A late "machine" is not trusted once the lead has answered** - found on a
  real transfer, 2026-10-20 (call 24): the verdict said machine after the lead
  had said "Yes." at 0.89 and was being put through. Acting on it would have
  hung up on a person who said yes. Once a call has a kept answer - a choice,
  or a key - a "machine" verdict changes nothing: no message, no stopped
  transfer, and the outcome stays `answered`, not `voicemail` (today T12 saves
  `voicemail` for any answered call a machine picked up). Noted 2026-10-20.

**Done when**
- [ ] A real call to Jeel's voicemail: the whole message is recorded after
      the beep; "Voicemail left" is saved.
- [ ] Route tests: machine, fax, person, not sure; "machine" after the lead
      has answered -> ignored.

**Files:** `backend/src/api/twilio-webhooks.ts`, `backend/src/integrations/twilio-calls.ts`,
`backend/src/db/auto-calls.ts`.
**Doc:** this one, `TWILIO.md`, "Voicemail".

---

#### T19 - A lead calling back reaches someone

**Goal:** a lead who calls (480) 470-8259 back reaches a person, even when no
agent owns them.
**Needs:** T10, T11. **Production:** none until `AUTO_CALLS` is on.

**Build**
- Who rings for an incoming call: the lead's holder -> the last agent who
  called them (a robot call an agent took counts) -> **everyone free**
  (`ring=group`) -> nobody, missed call as today.
- A group ring's end is taken from the call itself, never from one person's
  ring stopping, so the lead is not sent the missed-call text while someone
  is talking to them.
- Only with `AUTO_CALLS` on; off, it works exactly as today.
- Decide the incoming card's "Calling back" line for a lead returning the
  automated call - T5 counts only agents' calls there, so today it says
  nothing; "Calling back · automated call, 2h ago" is one way. Noted 2026-10-18.

**Done when**
- [ ] A live check: holder; last caller; everyone free; nobody free -> missed.
- [ ] A real call back after T18's voicemail rings the free browsers.
- [ ] With `AUTO_CALLS` off, the existing incoming-call tests pass unchanged.

**Files:** `backend/src/db/calls.ts`, `backend/src/integrations/twilio.ts`,
`backend/src/api/twilio-webhooks.ts`.
**Doc:** `TWILIO.md`, "Who rings".

---

### Calling on its own

#### T20 - The robot places the calls by itself

**Goal:** the right leads are called at the right time, at the pace the
people taking them can handle.
**Needs:** T12-T19. **Production:** none until `AUTO_CALLS` is on.

**Build**
- A new job in the worker loop, every 30 seconds, only with `AUTO_CALLS` on,
  calling set up, and inside the call hours and days.
- Who: arrived after `auto_calls_since` (saved the first time it runs
  switched on), first text sent at least 1 hour ago, no reply, not blocked,
  not held, not Closed, never called by the robot. Oldest first.
- How many: people free, minus robot calls still going (no end, started
  within 10 minutes). None while anyone is on hold. None when nobody is free.
- Places each call as in T12, through `worker/place-auto-call.ts`, with
  `readAutoCallTestNumbers(env, NODE_ENV === 'production')`.
- Closes a row whose call never reached Twilio (T12: Twilio did not answer,
  and no webhook ever came) - for example as `failed` after 10 minutes, so it
  is not "under way" for ever.

**Done when**
- [ ] A live check of who is picked: the 1-hour wait, the hours, the days,
      held, Closed, blocked, already called, arrived before
      `auto_calls_since`.
- [ ] A live check of timing: picked on the first check after its hour is
      up; one whose hour ended overnight is picked first at 11am.
- [ ] A live check of pace: never more calls than people free; none while
      someone is on hold; two workers never call the same lead.
- [ ] A real run on the dev number, to test numbers only.

**Files:** `backend/src/worker/auto-calls.ts`, `backend/src/worker/index.ts`,
`backend/src/db/auto-calls.ts`, `scripts/auto-calls-live-check.ts`,
`scripts/live-checks.sh`.
**Doc:** this one, `POLLER.md` (the worker loop).

---

### Screens

#### T21 - The timeline shows the robot calls

**Goal:** an agent opening a lead sees what the robot did and what the lead
said.
**Needs:** T13. **Production:** none until robot calls exist.

**Build**
- One line per robot call, in the timeline and the workspace conversation:
  "Automated call · voicemail left", "· link sent", "· not interested", "·
  opted out", "· no response", "· no answer", "· said yes · Maya Chen took
  it · 2:14", "· said yes · nobody free".
- Underneath, closed until opened like a transcript: each question and what
  the lead said ("Q1 · 'yeah sure' -> Yes").

**Done when**
- [ ] Tests for every line.
- [ ] Seen in the browser on a lead after a real call.

**Files:** `backend/src/db/timeline.ts`, `frontend/src/components/Timeline.tsx`,
`frontend/src/pages/workspace/Conversation.tsx`.
**Doc:** `AGENT-WORKSPACE.md`.

---

#### T22 - The queue puts a missed "yes" first

**Goal:** a lead who said yes and reached nobody is the next one an agent
calls.
**Needs:** T15a. **Production:** none until robot calls exist.

**Build**
- A lead whose robot call ended `transfer_missed` is in the queue, at the
  top, tagged "Wants a call".
- It stays until an agent calls it, texts it, or saves an outcome - as a
  missed call does.
- One shared definition in `db/lead-state.ts`, used by the queue.

**Done when**
- [ ] A live check: in the queue, at the top; gone after an agent's call,
      text or outcome.
- [ ] `npm run speed`: the queue still loads quickly with 50,000 leads.

**Files:** `backend/src/db/lead-state.ts`, `backend/src/db/queue.ts`,
`backend/src/core/queue-tags.ts`, `frontend/src/components/QueueStatus.tsx`.
**Doc:** `QUEUE.md`.

---

#### T23 - Admin > Leads: the Call column

**Goal:** a superadmin sees every lead's robot-call result and can filter on
it.
**Needs:** T4. **Production:** an empty column until robot calls exist.

**Build**
- A **Call** column: the last robot call's result, in short words, or blank.
- A filter on it, kept in the address like the other filters.
- No new status or tab.

**Done when**
- [ ] Tests: the column and the filter.
- [ ] Seen in the browser.
- [ ] `npm run speed`: Admin > Leads still loads quickly.

**Files:** `backend/src/db/leads.ts`, `backend/src/api/admin/leads.ts`,
`frontend/src/pages/admin/LeadsPage.tsx`, `frontend/src/lib/leads-view.ts`.
**Doc:** `ADMIN-LEADS.md`.

---

#### T24 - Admin > Configuration shows the call script

**Goal:** a superadmin can read the call script and its settings, as the
robot will use them.
**Needs:** T6. **Production:** visible, read-only.

**Build**
- A "Call script" section: each question, its answers and replies, the
  repeat line, the voicemail, the busy and hold lines, the link text.
- The call settings: hours, time zone, days, wait, ring time, hold safety
  stop.
- Read-only, like the rest of the page.

**Done when**
- [ ] Seen in the browser, matching the database.

**Files:** `backend/src/db/admin-config.ts`, `frontend/src/pages/admin/ConfigPage.tsx`.
**Doc:** `ADMIN.md`.

---

### Finish

#### T25 - Everything written down and checked end to end

**Goal:** the docs describe what was built, and one script proves the whole
path.
**Needs:** T0-T24. **Production:** none.

**Build**
- This doc: every section says what is built.
- `LEAD-FLOW.md` and `CLAUDE.md` mention robot calls.
- The end-to-end script (`npm run e2e`) covers a robot call, with Twilio's
  requests simulated.

**Done when**
- [ ] `npm run e2e` passes.
- [ ] A read of every doc against the code finds nothing out of date.

**Files:** `scripts/end-to-end.ts`, docs.
**Doc:** all of the above.

---

#### T26 - Real phone, every path, then live

**Goal:** every path has been heard on a real phone, and production is
switched on.
**Needs:** T25. **Production:** switched on at the end, by Jeel.

**Build**
- On the dev number, to Jeel's phone, with two browsers: yes taken; yes
  nobody; yes on hold then taken; no -> link; no -> no; stop; silence twice;
  keys; voicemail; calling back after the voicemail.
- The link text checked on a real phone: https://www.edrugstore.com/anti-ez.
- Deploy with `AUTO_CALLS` off; migrations run; then Jeel sets `AUTO_CALLS=on`
  and watches the first calls.

**Done when**
- [ ] Every path above heard and saved correctly.
- [ ] The first real robot calls on production, seen on the timeline and
      Admin > Leads.

### Other tickets - not calling

Kept in this tracker so there is one list. Same rules: one branch, one PR into
`dev`, code, tests and docs together.

#### W1 - Day dividers in the agent's conversation

**Goal:** an agent reading a lead's conversation can tell which day each text
and call happened, as in WhatsApp. Asked for by Jeel, 2026-10-17: the
conversation shows only times ("12:48 PM", "2:40 PM"), so a lead worked over
several days reads as one afternoon.
**Needs:** nothing. **Production:** visible once deployed - a divider in the
workspace conversation wherever the day changes.

**Build**
- In the agent workspace's conversation (`pages/workspace/Conversation.tsx`),
  a small centred label before the first item of each day: **Today**,
  **Yesterday**, then **Wed, Oct 14** - the year only when it is not this year.
- The Lead Timeline page already has day dividers (`components/Timeline.tsx`,
  "WED, OCT 14"). Both screens use one shared rule, `dayLabel` in
  `lib/format.ts`, so they say the same - the timeline gains Today and
  Yesterday too.
- The day is the viewer's own, from the browser's time zone, like every other
  date on screen.
- In the app's existing style: muted, like the system lines; no new colours.
  Every message keeps its time.
- Any kind of item starts a new day - a text, a call or a system line.

**Done when**
- [x] Tests: `dayLabel` - today, yesterday, earlier this year, another year,
      either side of midnight, across a month and a year.
- [x] Tests: the conversation shows one divider per day, before that day's
      first item, and none between items of the same day; each item keeps its
      time.
- [x] Seen in the browser on a lead with texts and calls over several days -
      the conversation and the Lead Timeline both read Thu, Oct 15 /
      Yesterday / Today; no console errors.

As built: the two copies of "same day" in `lib/format.ts` and the timeline's
own day format now use the shared `isSameDay` and `formatDay`, so there is one
rule for days.

**Files:** `frontend/src/lib/format.ts` (+ test),
`frontend/src/pages/workspace/Conversation.tsx` (+ test),
`frontend/src/components/Timeline.tsx`, `frontend/src/styles/workspace.css`.
**Doc:** `FRONTEND.md`, `AGENT-WORKSPACE.md`.

## Decided with the client

Nothing is left to confirm before building (2026-10-17). What was decided, and
by whom:

| What | Decided | By |
|---|---|---|
| When a lead is called | 1 hour after the first text, if they have not replied | Jeel, 2026-10-15 |
| The window | 11am-5pm, **Arizona time**, **Monday to Friday** | the client (hours, 2026-10-13); Jeel (time zone and days, 2026-10-17) |
| The opening line | "Hi, this is Seri calling from eDrugstore. Today we're offering 25% off antibiotics. Are you interested in ordering?" - no "This is an automated call", and the offer before the question | Jeel, 2026-10-18, after the first real call. "This is an automated call" had been told to the client on 2026-10-14 |
| The voice | Google Chirp3-HD **Kore**, US English, chosen by ear on a real phone | Jeel, 2026-10-18 |
| Calls per lead | **One.** No second try for now | Jeel, 2026-10-17 |
| The link texted on "yes" | The one the SMS script already sends: https://www.edrugstore.com/anti-ez | Jeel, 2026-10-17 |
| A "yes" nobody takes | The busy line, and the lead first in the agents' queue as "Wants a call" | Jeel, 2026-10-17 |
| Email | None anywhere: the email branch and the email line in the voicemail are dropped | Jeel, 2026-10-15 |

To tell the client: called 1 hour after the first text, Arizona time, Monday
to Friday; one call per lead; no email; the opening no longer says "This is an
automated call" (they were told it would on 2026-10-14) and now says the offer
before asking, and the voice is a more natural one.

## Not in Stage 1

- The AI agent (Stage 2), from the "not understood" branch.
- A day-3 reminder text for leads still silent - a separate task once calling
  is stable, if the client agrees (Jeel, 2026-10-15).
- Sending email.
- A second call (unless the client asks for one).
- Calling in each lead's own time zone.
- A lead's own call back waiting on the hold line - only transfers wait.
