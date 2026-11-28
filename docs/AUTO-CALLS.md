# Automated outbound calls

**Status:** Done 2026-11-02 - T0 to T29 merged; live on production since 2026-10-30
([`auto-call-tickets/`](auto-call-tickets/README.md)).

The robot's call: most leads never answer the SMS questions, so the server calls a
lead who has not answered the first text, says a short script, and puts a "yes"
through to a person who is free. This doc is Phase 6's design and its hub - who is
called and when, how many at once, how a call is placed, its webhooks, what is
saved and where it shows. What the call says and how it hears an answer, voicemail
included, is [`AUTO-CALL-SCRIPT.md`](AUTO-CALL-SCRIPT.md);
who is free, the transfer, the hold line and a lead calling back is
[`AUTO-CALL-TRANSFER.md`](AUTO-CALL-TRANSFER.md); Seri, the AI agent who runs the
call when she is switched on, is [`AI-AGENT.md`](AI-AGENT.md). The dialler is
`backend/src/worker/auto-calls.ts` with `backend/src/db/auto-dial.ts` and
`backend/src/core/auto-dial.ts`; a call is placed by
`backend/src/worker/place-auto-call.ts` and answered by the `/auto/*` webhooks in
`backend/src/api/twilio-webhooks.ts`.

## How it works

### The whole flow

```
LEAD ARRIVES
  -> text: question 1, at once
       replies -> the SMS flow; never called
       no reply 1 hour after the text -> AUTOMATIC CALL, if all of these hold:
           inside 11am-5pm (else at 11am the next calling day, oldest first)
           someone is free to take a "yes", and nobody is on hold
           not picked up by an agent, not Closed, not blocked
           never called by the robot before
         no answer  -> No answer
         voicemail  -> the voicemail message -> Voicemail left
         picks up   -> the script - or Seri, when she is switched on (AI-AGENT.md)
  -> day 7 -> expires, as every conversation

TRANSFER ("Great, connecting you with a live agent now. Please hold." + recording notice)
   lead already picked up by someone who is free -> they ring alone first, 25 s
       not free, or not taken -> on to everyone free; whoever takes it holds the lead
   otherwise -> everyone free rings for 25 s; the first to accept holds the lead
   nobody accepts:
       someone is on a call, or writing the note of one -> HOLD
           hold music, and "You are next." / "You are number 2 in line."
           someone comes free (note saved or skipped, or switched on)
               -> the lead who has waited longest rings them alone, 20 s
                  taken -> theirs; not taken -> back on hold, never offered
                  to them again (rang out: their switch off, as above)
           checked again every 30 s:
               nobody coming for them any more        -> busy line
               10 minutes (safety stop)               -> busy line
       nobody on a call or writing a note -> busy line at once
   busy line: "All our agents are busy right now. An agent will call you back shortly."
       -> the lead goes to the top of the agents' queue as "Wants a call"

LEAD CALLS (480) 470-8259 BACK
   -> whoever holds them -> else the last agent who called them -> else everyone free
   -> nobody -> missed call (INCOMING-CALLS.md, "A missed call")
```

The script's words are in `AUTO-CALL-SCRIPT.md`, "The script"; the transfer and the
hold line in `AUTO-CALL-TRANSFER.md`.

### When a lead is called

The robot is the worker's last job on each tick, about every 30 seconds, while
automated calls are on and calling is set up (`worker/auto-calls.ts`,
`dialDueLeads`). So a call goes out within a tick of the hour being up - the half
minute's wait plus the tick's other work, the poll first.

A lead is called (`leadsToCall`, `db/auto-dial.ts`) when:

- its first text went out at least `auto_call_wait_minutes` (60) ago - the
  conversation's `question_sent_at` - and that conversation is still open: not
  answered, expired or stopped;
- it has not replied - no text from it, **and no call from it either**: a lead
  reaching us by phone is a person's to deal with;
- nobody holds it, and nobody has worked it (`WORKED_SQL`, `db/lead-state.ts`: a
  note, a callback, an outcome - Closed among them - an agent's call or text);
- its number is not blocked (a block lifted by START is not), and it has not had its
  robot call - a call Twilio never placed is not one, up to three ("When Twilio
  refuses").

**The order.** New leads first - those that arrived after `auto_calls_since`, when
automated calls were last switched on ("Leads already waiting") - then the ones
already waiting. Within each, those Twilio has refused fewest times for our account
first (`not_placed`), so the first try after a pause goes to a lead it has not
tried; then oldest first, by when the first text went out. A lead whose hour ended
outside the calling hours is called at the start of the next ones, before newer
leads. Only leads from the last 30 days are looked at (`LOOK_BACK_DAYS`): no
conversation stays open that long.

**The hours** are `auto_call_hours_start` and `_end` in `auto_call_time_zone`, on
`auto_call_days` (`readCallHours`, `db/call-script.ts`), checked in that zone
(`insideCallHours`, `core/auto-dial.ts`). The start and end fall back together to
migration 015's when either is malformed or the end is not after the start; the
zone, the days and the wait each fall back on their own. A typo never moves the
calls to another time.

**Outside production only the test numbers are looked at at all**
(`AUTO_CALL_TEST_NUMBERS`), so a laptop's fake leads are never even tried. Each lead
is then **asked again just before its call** (`stillDue`): the calls of one look go
out one after another, each waiting on Twilio, and meanwhile a lead may reply, ring
us or be picked up. Then it is placed - "How a call is placed".

### Leads already waiting

When automated calls are switched on, the leads already waiting for a reply are
called too. Nothing is started or stopped by hand.

- **Which:** every lead the robot would call anyway ("When a lead is called"),
  whenever it arrived. One whose conversation expires at 7 days is not called.
  Outside production, the test numbers only.
- **When:** after new leads. A new lead keeps its call an hour after its text; the
  waiting ones fill the room left - five calls for each person free, less the calls
  going ("Traffic") - oldest first, so the lead nearest expiring goes first. Inside
  the calling hours only, as every call. With people free and no new lead due, the
  first calls after switching on go to them.
- **Once, as every lead.**
- **Switched off and on again:** the leads that arrived while it was off are waiting
  ones too, called after the new ones.

**When they were switched on.** When the worker starts with automated calls on after
they were off - or never on before - now is when they were switched on
(`recordAutoCallsSwitch`, `settings.auto_calls_on` and `auto_calls_since`). It
decides only the order: `leadsToCall` puts the leads that arrived after it first
(`ORDER BY l.created_at > since DESC`), and those that arrived before it - while
automated calls were off, or before they were ever on - after them. A restart while
on changes nothing. Each switch-on is recorded with the start it replaced
(`auto_calls.switched_on`). A value in `auto_calls_since` that is not a time is an
error, never a guess (`autoCallsSince`). Switching the robot on and off is the
`AUTO_CALLS` variable (`ENVIRONMENT.md`), changed as `DEPLOY.md` says.

### Traffic

The robot slows down and stops by itself:

- never more than five calls at once for each person free;
- none while anyone is on hold;
- none when nobody is free;
- none outside the calling hours.

The room (`callsToPlace`, `core/auto-dial.ts`; `dialRoom`, `db/auto-dial.ts`) is
`auto_call_calls_per_person` calls for each person free (`FREE_SQL`,
`AUTO-CALL-TRANSFER.md`, "Who is free") less the robot's calls still going with
nobody on them - no end, started within 10 minutes (`UNDER_WAY_MINUTES`). A call
taken by someone is theirs, so they are no longer free. With two people free and
three calls going, seven more go out; with one free, five in all.

The setting is 5 (migration 021), read on every look (`readCallsPerPerson`); anything
but a whole number from 1 to 10 is 5. It is shown on Admin > Configuration > Calls.
More calls at once means two "yes"es can come together: the second rings whoever is
still free, and with nobody left it waits on the hold line while someone is on a
call or being rung - the robot then places nothing until it is taken or sent to the
busy line (`AUTO-CALL-TRANSFER.md`, "The hold line"). Twilio places an account's
calls at its own pace, one a second unless raised, and holds the rest in line for a
moment rather than refusing them.

Nothing at all is placed while:

- **a lead waits on hold** - counting only a hold younger than the safety stop and
  two minutes: no real one lasts longer, so an older one is a call whose end never
  reached us (the hold watcher ends it from Twilio's record), and it must not stop
  the robot for good;
- **Twilio's reports are not reaching us** - a call of the robot's placed 3 to 60
  minutes ago (`SILENT_AFTER_MINUTES`, `SILENT_FOR_MINUTES`) with neither an end nor
  Twilio's verdict on who answered; every call has one or the other within a minute
  and a half, ringing out included. Each new call would reach a lead as Twilio's
  "application error" and use up the one call they get. Logged once, as an error,
  `auto_call.webhooks_silent` - `PUBLIC_URL` wrong, the api down, or switched off
  without the worker;
- **no call script is active** - logged once, `auto_call.no_script`;
- **Twilio refused one of its calls for our account's reasons, or never confirmed
  placing it, in the last 15 minutes** - logged once, as an error,
  `auto_call.twilio_refusing` ("When Twilio refuses");
- **with Seri switched on**: OpenAI not answering a one-word check, asked at most
  once a minute and only when there is room to place calls
  (`ai_agent.openai_down`), or her last three calls all falling back to the script,
  the latest within the same 15 minutes (`ai_agent.fallbacks_paused`) - `AI-AGENT.md`.
  A lead's one call is never spent on a broken Seri. With her off, neither is
  asked: the script needs no OpenAI.

**One look at a time.** The room and the leads are read holding an advisory lock
(`withDialLock`), so two workers never dial together; a connection whose lock could
not be let go is thrown away, never handed back holding it. The same lead is never
called twice regardless (`startAutomatedCall`, `calls_one_automated_per_lead`).

**Calls that never reached Twilio.** A call of the robot's whose placing Twilio never
confirmed - its row is left when Twilio's answer does not come, in case it went
out - is closed after 10 minutes with no webhook naming it: `failed`, `not_placed`,
not the lead's call ("When Twilio refuses"), its `call.ended` saying `no_webhook`, all
that is known (`closeUnplacedCalls`). A webhook naming it after that is not taken
for it (`linkAutomatedCall`).

### When Twilio refuses

Each lead gets one robot call, and a problem with our own Twilio account - a wrong
key, the account suspended, too many requests - must not use it up: otherwise, with
5 people free, 5 leads every half minute would be refused, none ever called.

- **Refused for the lead's own number** - not a valid number, not reachable, or one
  Twilio will not call (Twilio's codes 13223, 13224, 21211, 21214, 21216, 21217;
  `refusedForTheNumber`, `core/auto-dial.ts`): the lead's call, used - `failed`,
  `unanswered`, `auto_call.failed`. Trying again would only be refused again.
- **Refused for any other reason** - the key, the account, a limit, a setting, or no
  code at all: **not the lead's call**. The row is kept, ended `failed` with
  `script_result` `not_placed`, its `call.ended` saying `reason: not_placed` with
  Twilio's status and code (`failAutomatedCall`); `auto_call.not_placed` (error).
  The lead stays due.
- **Never confirmed** - Twilio did not answer, and no webhook named the call within
  10 minutes (`closeUnplacedCalls`): `not_placed` too.
- **The robot stops for the rest of that look** at such a refusal, or at a request
  Twilio did not answer - the next would go the same way - **and pauses for 15
  minutes** after a `not_placed` (`REFUSED_PAUSE_MINUTES`, `dialRoom`'s `refused`).
  Then it tries again: one call first, to a lead it has not tried, and carries on if
  Twilio takes it. A long outage costs one try every 15 minutes, never a lead.
- **Three `not_placed` and the lead's call counts as used** (`NOT_PLACED_LIMIT`,
  `automatedCallUsedSql`, `db/auto-calls.ts`) - so a refusal of the lead's own that
  we take for ours cannot hold the robot on that lead for ever.

A `not_placed` call never reached the lead, so no screen shows it: not the
timeline, not the incoming-call card, and Admin > Leads reads Not called. The
database keeps the rule: `calls_one_automated_per_lead` (migration 014) covers every
automated call but `not_placed` ones - so a lead can have a fresh row after one, and
two placements still cannot race, since a row being placed has no result yet.

### How a call is placed

One path, `worker/place-auto-call.ts` (`placeAutoCall`), for the dialler and the dev
command:

1. **The row first** - `startAutomatedCall` (`db/auto-calls.ts`), one transaction
   with the lead locked: the call's `calls` row (`direction = 'automated'`, no
   agent) and its `call.started` record. It refuses, writing no row and recording
   `call.refused` with why: `not_found`; `blocked` (the do-not-call list);
   `already_called` (one automated call per lead); `no_script` (none active);
   `not_test_number`.
2. **Then Twilio, once** - `integrations/twilio-calls.ts`, the only file that rings a
   phone through Twilio's API. Ten seconds, and the library's own retry off: a
   request Twilio has not answered is given up, never repeated, since it may have
   gone out and a second could ring the lead twice.
3. **Twilio's answer.** Placed: its id is kept on the row. Refused (a 4xx): the row
   is ended as `failed`, recorded with Twilio's status and error code - never its
   message, which can quote the number - as the lead's call if Twilio refused their
   number, otherwise `not_placed` ("When Twilio refuses"). No answer, or a 5xx: the
   row is left as it is; if the call did go out, its first webhook fills in the id.
   A row whose call never went out is closed after 10 minutes ("Traffic").

**Outside production, only our own phones are rung** - the numbers in
`AUTO_CALL_TEST_NUMBERS`; what it holds, and how a mistyped entry is counted, is
`ENVIRONMENT.md`'s. It is checked in step 1 (`mayRing`), so the dev command and the
dialler both obey it.

**What Twilio is asked for** (`automatedCallRequest`): our number as caller ID; the
phone rings up to 60 seconds (`LEAD_RING_SECONDS`), long enough for a voicemail to
answer; voicemail detection beside the call, not in front of it (`asyncAmd`,
`DetectMessageEnd`), so the lead hears the question at once and the verdict arrives
later (`AUTO-CALL-SCRIPT.md`, "Voicemail"). Nothing is recorded: the recording, and
its notice, start only with a transfer (`AUTO-CALL-TRANSFER.md`, "The transfer").

### The call's webhooks

Each names the call's row, `?call=<id>`, in the address Twilio signs, so the row
cannot be swapped: a request for row 43 signed as row 42 is refused. A webhook whose
row is not an automated call, or is linked to another Twilio call, is not acted on.
All nine answer 404 while automated calls are off, and 403 unsigned (`TWILIO.md`,
"Why the webhooks can be trusted"). The paths are constants in
`integrations/twilio.ts` (`AUTO_ANSWER_PATH` and the rest).

| Webhook | What it does |
|---|---|
| `POST /api/webhooks/twilio/auto/answer` | The lead picked up: a second's quiet, the greeting with nothing listening, then the question inside a `<Gather>` (`AUTO-CALL-SCRIPT.md`, "When the call listens"). Anything wrong - no row, no script, the database down - ends the call quietly, never Twilio's "application error". With Seri switched on, the call is connected to her instead (`seriTwiml`, `AI-AGENT.md`) |
| `POST /api/webhooks/twilio/auto/gather` | The answer read, what follows decided and kept, and the next line said (`AUTO-CALL-SCRIPT.md`, "On a live call"). The address names the step and which asking it was. A yes to the link is texted after Twilio has its answer; a yes to the transfer rings (`AUTO-CALL-TRANSFER.md`, "The transfer") |
| `POST /api/webhooks/twilio/auto/status` | How it ended, saved as every call's end is (`finishCall`): outcome, talk time, `call.ended`; then an unfinished script given its result (`settleAutomatedCall`). Never a missed-call text |
| `POST /api/webhooks/twilio/auto/amd` | Who picked up, kept as `answered_by`, then acted on: a machine gets the voicemail message, a fax is hung up on - the beep decides (`AUTO-CALL-SCRIPT.md`, "Voicemail"). Twilio has its answer first |
| `POST /api/webhooks/twilio/auto/claim` | A person accepted the transfer: the call and the lead become theirs (`takeTransfer`), run on their leg before they are connected |
| `POST /api/webhooks/twilio/auto/after` | The transfer's ringing is over: taken, nothing more; the lead's own agent did not take it, everyone else free rung; not taken, the hold line or the busy line; whoever let it ring out switched off. A ring from hold not taken: back on hold. The address names the step and who was rung - `holder`, `rung` or `offer` (`AUTO-CALL-TRANSFER.md`) |
| `POST /api/webhooks/twilio/auto/hold` | A lead waiting on hold: their place, a track of hold music, then back here; nobody coming any more, or the safety stop, the busy line. Asked when a track ends, and by the hold watcher (`via=watcher`) (`AUTO-CALL-TRANSFER.md`, "The hold line") |
| `POST /api/webhooks/twilio/auto/offer` | A lead on hold ringing the one person who came free, for `auto_call_offer_ring_seconds` (`AUTO-CALL-TRANSFER.md`, "The next person who comes free gets the waiting lead") |
| `POST /api/webhooks/twilio/auto/ai-after` | Only on a call Seri took: her part is over, and her action is carried out with this phase's code - the transfer, the link, a stop's block, a goodbye's result - or the script takes the call from its first question when she failed (`AI-AGENT.md`) |

`/incoming/claim`, a person taking a lead's call back that rang everyone free, is
also answered only while automated calls are on (`AUTO-CALL-TRANSFER.md`, "A lead
calling back").

### Trying it locally

`npm run dev:auto-call -- <phone>` (`scripts/dev-auto-call.ts`) calls the local lead
with that number. It needs, in the environment the api runs with: calling set up,
`PUBLIC_URL` a tunnel, `AUTO_CALLS=on`, and the number on `AUTO_CALL_TEST_NUMBERS`
(`ENVIRONMENT.md`) - checked before anything is written. No `twilio:configure`: each call carries its own
webhook addresses, so the number and the TwiML App are not involved. It refuses in
production (`NODE_ENV`). Setting up the dev number: `TWILIO-SETUP.md`.

One phone gets one automated call - one lead per number, one call per lead - so two
flags, for the local database only:

- `--again`: when the lead holding the number has had its call, the number is given
  to a fresh test lead, as if the partner had sent it new, and that lead is called -
  otherwise the lead holding it is. The old one keeps all its history under a
  made-up number, `+1555` and its id; nothing is deleted.
- `--unblock`: lifts the block a stop test left on the number, released as
  `dev_test`, so the next test can call it.

**A lead it calls has a text conversation**, as every lead the poller saves has: the
fresh test lead, or one made by hand without one, is given one - open, on the first
question, marked as sent with its seven days to reply, as the opener marks it once
the text goes out - but nothing is texted. So a test lead is what the robot calls:
asked by text, no reply. Marked as sent, the opener retry never takes it for a first
question that failed and texts the phone; and the queue, which reads each lead's
newest conversation, lists it once an agent holds it after a transfer.

### Where it shows

| Screen | What |
|---|---|
| Lead timeline and workspace | "Automated call · voicemail left", "· said yes · Maya Chen took it · 2:14", "· said yes · nobody took it", "· link sent", "· not interested", "· opted out", "· no response", "· hung up", "· no answer" - with what the lead said underneath, under **Answers** (`TIMELINE.md`, "The robot's call"); "Phone call - automated questions stopped" once the lead has answered (`STATE-MACHINE.md`, "2d"). A call Seri took also reads "· callback booked", with her conversation under **Seri** (`AI-AGENT.md`) |
| Agents' queue | A "yes" nobody took: first, the longest waiting on top, "Wants a call" - and a Wants a call badge on the lead's card - until an agent calls or texts them, answers when they ring, or saves an outcome. A call back Seri booked, once due, beside it at the top, "Callback · 3:00 PM" in bold (`QUEUE.md`, "Who is in it", "The order", "The tag"; `CALLBACKS.md`, "Seri's call backs") |
| Admin > Leads | A **Call** column with the robot call's result - "Voicemail left", "Said yes · nobody took it", "Calling now" - and a filter on it. No new status or tab: a lead is on two tracks at once, "Awaiting reply" and "Voicemail left" (`ADMIN-LEADS.md`, "Call") |
| Admin > Configuration | On its Calls tab, beside Seri's switch, the call script line by line with what picks each answer, and the settings the robot reads - on or off, hours, time zone, days, the wait, ring times, calls at once, the hold stop, the confidence a spoken answer needs, the call-back number; the link text with the other texts, on Texts. Read-only but for Seri's switch (`ADMIN.md`, "The automated call") |
| App bar | The "Taking calls" switch (`AUTO-CALL-TRANSFER.md`, "The "Taking calls" switch") |
| Incoming-call card | "Transfer · said yes to the offer"; for a lead returning the robot's call, "Calling back · automated call, 28m ago" (`INCOMING-CALLS.md`) |

### Seri, the AI agent

With her switch on and her OpenAI key set, an answered robot call is hers from the
start, and this script is her backup: `/auto/answer` connects the call to her, and
`/auto/ai-after` carries out how her part ended through this phase's code - her
transfer goes through the same `planYes` and `yesTwiml` as the script's "yes"
(`AUTO-CALL-TRANSFER.md`, "The transfer"). Voicemail while she talks follows the same
beep rule (`AUTO-CALL-SCRIPT.md`, "Voicemail"). How she talks, decides and is
switched on is `AI-AGENT.md`.

### The sections that moved

Code comments quote this doc's sections by name. Those that moved are now:

| Section | Now in |
|---|---|
| "The script", "Understanding an answer", "When the call listens", "How fast", "What the call does after each answer", "On a live call", "Voicemail" | [`AUTO-CALL-SCRIPT.md`](AUTO-CALL-SCRIPT.md) |
| "Who is free", "The "Taking calls" switch", "Letting a transfer ring out turns it off", "The transfer", "The hold line", "The next person who comes free gets the waiting lead", "A lead calling back" | [`AUTO-CALL-TRANSFER.md`](AUTO-CALL-TRANSFER.md) |
| "Tracker", the tickets T0 to T29 | [`auto-call-tickets/`](auto-call-tickets/README.md) |
| "What is saved" | "Data", below |

## Rules

1. **One call per lead**, an hour after its first text, and only while it has not
   replied by text or phone, nobody holds or has worked it, its number is not
   blocked and its conversation is open. No second call, whatever happened on the
   first.
2. **Only inside the calling hours** - 11:00 to 17:00 America/Phoenix, Monday to
   Friday, from `settings`. A lead whose hour ends outside them is called at the
   start of the next, before newer leads.
3. **Never more calls than the people free can take** - five for each person free,
   less the calls going - and none while a lead is on hold, nobody is free, no script
   is active, Twilio is silent or refusing, or, with Seri on, OpenAI is down or her
   calls keep falling back.
4. **A Twilio refusal for our own account never spends a lead's call**; three such
   refusals do.
5. **Outside production only `AUTO_CALL_TEST_NUMBERS` are rung**, and only they are
   looked at.
6. **The row before Twilio, and Twilio once.** The call's row is written before
   Twilio is asked; a request is never repeated.
7. **Every webhook names its row in the address Twilio signs**; all of them answer
   404 while automated calls are off.
8. **A robot call is not an agent's work.** It does not make a lead Working and does
   not answer a missed call - until an agent takes the transfer.
9. **Nothing is overwritten.** A call's result is saved once; every action is an
   `activity_log` row (`AUDIT.md`).

## Data

Nothing is overwritten (`AUDIT.md`). The columns are in `SCHEMA.md`.

| What | Where |
|---|---|
| The call | `calls`, with `direction = 'automated'`; `agent_id` empty until someone takes a transfer; `held_at`, when it went on hold; `outcome` is `voicemail` only when Twilio's verdict took the call over (`AUTO-CALL-SCRIPT.md`, "Voicemail") |
| How it ended | `calls.script_result`: `transferred`, `transfer_missed`, `link_sent`, `not_interested`, `opted_out`, `no_response`, `voicemail_left`, `hung_up`, `unanswered`; `not_placed`, a call Twilio never placed for our account's reasons - not the lead's call ("When Twilio refuses"); and `callback_booked`, Seri's alone (`AI-AGENT.md`) |
| What the lead said | `call_answers`, one add-only row per answer (`AUTO-CALL-SCRIPT.md`) |
| The script | `call_scripts`, `call_steps`, `call_choices` - rows, changed by migration (`AUTO-CALL-SCRIPT.md`, "Data") |
| When it calls | `settings`: `auto_call_hours_start` 11:00, `auto_call_hours_end` 17:00, `auto_call_time_zone` America/Phoenix, `auto_call_days` mon,tue,wed,thu,fri, `auto_call_wait_minutes` 60, `auto_call_calls_per_person` 5 - and the call's own: `auto_call_ring_seconds` 25, `auto_call_hold_max_minutes` 10, `auto_call_min_confidence` 0.4, `auto_call_offer_ring_seconds` 20; `ai_agent` `off`, Seri's switch (`AI-AGENT.md`). Written by the worker: `auto_calls_on` and `auto_calls_since` ("Leads already waiting") |
| The link text | `messages`, like every text |
| Who is free | `users.taking_calls`, `taking_calls_at`, `taking_calls_why`, `ringable_until` (`AUTO-CALL-TRANSFER.md`) |
| Each ring from hold | `call_offers` - written once, ended once, never removed (`AUTO-CALL-TRANSFER.md`) |
| Every action | `activity_log` - `call.started`, `call.refused`, `call.ended`, `auto_calls.switched_on` and the rest (`AUDIT.md`); the log lines, `auto_call.*` (`LOGGING.md`) |

## Code

| File | What it does |
|---|---|
| `backend/src/worker/auto-calls.ts` | One look of the robot's: close calls that never reached Twilio, inside the hours only, the room, the leads due, each asked again and placed (`dialDueLeads`); nothing while Seri is on and cannot take calls |
| `backend/src/worker/index.ts` | Runs the look last on each tick; records the switch-on at start (`recordAutoCallsSwitch`); logs each stop once |
| `backend/src/db/auto-dial.ts` | `leadsToCall`, `stillDue`, `dialRoom`, `closeUnplacedCalls`, `withDialLock`, `recordAutoCallsSwitch`, `autoCallsSince` |
| `backend/src/core/auto-dial.ts` | Pure: `insideCallHours`, `callsToPlace`, `refusedForTheNumber`, `UNDER_WAY_MINUTES` |
| `backend/src/worker/place-auto-call.ts` | `placeAutoCall` - the row, then Twilio, then its answer; whose refusal it is |
| `backend/src/db/auto-calls.ts` | The call in the database: `startAutomatedCall`, `linkAutomatedCall`, `failAutomatedCall`, `settleAutomatedCall`, `automatedCallUsedSql`, `NOT_PLACED_LIMIT` - and the script's and the transfer's writes (`AUTO-CALL-SCRIPT.md`, `AUTO-CALL-TRANSFER.md`) |
| `backend/src/db/call-script.ts` | The settings a call reads: `readCallHours`, `readCallsPerPerson`, and the script's own readers |
| `backend/src/integrations/twilio-calls.ts` | The only file that asks Twilio to ring a phone - once, never retried (`automatedCallRequest`); and redirects or reads a live call |
| `backend/src/integrations/twilio.ts` | Every TwiML, and the webhook paths (`AUTO_ANSWER_PATH` and the rest) |
| `backend/src/api/twilio-webhooks.ts` | The `/auto/*` webhooks, answered only while automated calls are on |
| `backend/src/auto-calls-settings.ts` | Reads `AUTO_CALLS` and `AUTO_CALL_TEST_NUMBERS` (`readAutoCalls`, `readAutoCallTestNumbers`, `mayRing`) - the variables are `ENVIRONMENT.md`'s |
| `backend/src/api/index.ts` | Automated calls count as on only with calling set up too (`deps.autoCalls`); starts the hold watcher |
| `backend/scripts/dev-auto-call.ts` | Local testing only: `npm run dev:auto-call`, with `--again` and `--unblock`; `scripts/dev-phone.ts` reads the number |

## Tests

| What | Where |
|---|---|
| Who is picked and when: the wait, the hours and days in the zone, held, worked, Closed, blocked, replied, rang us, already called, the order - new first, fewest `not_placed`, oldest; the room, the lock, closing calls that never reached Twilio; the leads already waiting; the pause after a refusal; the setting read every look | `scripts/auto-dial-live-check.ts` |
| Placing one call: the row, every refusal, linking, failing, two placements racing; refused for the number or for our account; used after three `not_placed` | `scripts/auto-calls-live-check.ts` |
| The hours, the days, malformed settings; the room; whose refusal it is | `src/core/auto-dial.test.ts`, `src/db/call-hours.test.ts`, `src/db/calls-per-person.test.ts` |
| A look's order and stops; the placing path | `src/worker/auto-calls.test.ts`, `src/worker/place-auto-call.test.ts` |
| What Twilio is asked for; no retry | `src/integrations/twilio-calls.test.ts` |
| The webhooks: signed, unsigned, another row's, 404 off | `src/api/__tests__/auto-call-webhooks.test.ts` |
| Admin > Leads' Call column, Not called; the call settings on Admin > Configuration; not on the timeline when `not_placed` | `scripts/admin-leads-live-check.ts`, `scripts/admin-live-check.ts`, `scripts/timeline-live-check.ts` |
| The whole path: automated calls on, three leads who never replied - Casey says yes and Maya takes it, Riley's yes rings out, Avery says no and then yes to the link - Twilio stubbed at its HTTP boundary and its webhooks posted signed | `npm run e2e` (`scripts/end-to-end.ts`, steps 10 to 13) |

The script's and the transfer's own tests are in their docs.

## Not done

- **A second call.** One per lead; a second try may come later, when Jeel says, or
  if the client asks for one.
- **A day-3 reminder text** for leads still silent - a separate task once calling is
  stable, if the client agrees.
- **Calling in each lead's own time zone.** The hours are Arizona's for every lead.
- **Email.** The app only texts.

## Decisions

| Decision | By | Date |
|---|---|---|
| Call the leads who never answer the texts, quickly, by an automated call between 11am and 5pm with a short script, and pass a "yes" to a live agent | Client | 2026-10-13 |
| Build it in two stages: a scripted call that follows the client's script word for word first; an AI agent later | Client | 2026-10-14 |
| A lead is called 1 hour after the first text, if they have not replied | Jeel | 2026-10-15 |
| A day-3 reminder text for leads still silent is a separate task, once calling is stable, if the client agrees | Jeel | 2026-10-15 |
| The window is Arizona time, Monday to Friday | Jeel | 2026-10-17 |
| One call per lead - no second try for now: a lead who does not pick up still has the first text, and the voicemail asks them to call back | Jeel | 2026-10-17 |
| The leads already waiting at the switch-on are called too - "whatever is in awaiting answer stage gets called" - after new leads, with nothing started or stopped by hand | Jeel | 2026-10-29 |
| A Twilio problem with our own account must not use up a lead's call - fixed before the deploy | Jeel | 2026-10-29 |
| Five calls at once for each person free, not one: most calls are not answered, or answered and not a "yes", so one each kept people waiting | Jeel | 2026-11-02 |
| Seri, the AI agent, runs the whole call from the start when switched on, with this script as her backup - in place of taking over only when a lead says something outside the script | Jeel | 2026-11-11 |

The script's decisions are in `AUTO-CALL-SCRIPT.md`; who is rung, the switch and
the hold line in `AUTO-CALL-TRANSFER.md`.

## History

- 2026-11-27 · Rewritten to the area template and split by topic: the script and
  voicemail to `AUTO-CALL-SCRIPT.md`; who is free, the transfer, the hold line and a
  lead calling back to `AUTO-CALL-TRANSFER.md`; the tracker and its 35 tickets to
  `auto-call-tickets/` (W1 and W2, not calling work, to `AGENT-WORKSPACE.md` and
  `STATE-MACHINE.md`); the decisions into one table. The Status line said "Being
  built", the Stage 2 row said Seri was not deployed, and the intro said calling
  ships with `AUTO_CALLS` off - all three out of date · docs to the standard ·
  D32-D37
- 2026-11-24 · Seri deployed to production with her switch off; the switch is on
  Admin > Configuration > Calls, beside the robot's settings · A22, PR #31
- 2026-11-23 · A call Twilio would not place for any reason but the lead's own number
  is `not_placed`, not `unanswered` - the doc still said `unanswered` for every
  refusal; the dial order's fewest-`not_placed` step written under "When a lead is
  called" · review R11
- 2026-11-22 · The worker says once, at start, how many `AUTO_CALL_TEST_NUMBERS`
  entries it ignored (review M25); `dev:auto-call` checks the number against them
  before it writes anything (M34); a call whose end never reached us is ended from
  Twilio's own record 15 minutes on (`api/left-open.ts`, `TWILIO.md`) · review
- 2026-11-12 · With Seri on, the robot places nothing while OpenAI does not answer,
  or for 15 minutes after her last three calls fell back; `/auto/answer` connects an
  answered call to her and `/auto/ai-after` carries out her part · A13, A14, A17
- 2026-11-11 · Stage 2 became its own phase: Seri runs the whole call from the start
  when switched on, the script her backup - it had been agreed that an AI agent
  would take over inside the call only when the lead said something outside the
  script, from the "not understood" branch · `AI-AGENT.md`
- 2026-11-02 · Five calls at once for each person free, a setting
  (`auto_call_calls_per_person`, migration 021) - one until then: about 200 robot
  calls on production that day put 3 leads through to a person · T29, PR #29
- 2026-10-30 · On `main` with migrations 014 to 020, deployed and switched on in
  production. Until then every calling ticket was merged and deployed with
  `AUTO_CALLS` off - the header switch, group rings, the call-back change and the
  dialler all hang on it; deployed with it off, Admin > Leads' Call column was empty
  and the Calls tab said Off. W1 and W2 changed production once deployed: W2's lead
  who has rung us gets no automated reply to their next text · T26
- 2026-10-29 · A Twilio refusal for our own account no longer uses up a lead's call:
  `not_placed`, a 15-minute pause, used after three; migration 014 changed in place,
  as production had not run it. Before, every lead tried during an account problem
  would have lost its one call · T28
- 2026-10-29 · The leads already waiting at the switch-on are called, after new
  leads - about 562 leads were awaiting a reply on production. First built the same
  day as a command run by hand on the server, with a setting for each switch-on;
  replaced before release, at Jeel's word - no manual start or stop. Nothing else
  changed: the room, the hours, and every rule a lead is called by · T27
- 2026-10-27 · Every path heard on a real phone, calls 66 to 85 · T26
- 2026-10-25 · T0 to T25 done: every doc read against the code; `npm run e2e` runs
  three robot calls · T25
- 2026-10-24 · The robot places its calls by itself. After an independent review the
  same day: an old hold no longer stops it, and the watcher ends such a call from
  Twilio's record; Twilio's reports not reaching us stop it, said once; each lead is
  asked again before its call; each switch-on starts afresh and is recorded (the
  backlog left out - reversed by T27); no script active means nothing placed, said
  once; a late webhook cannot run the script on a closed row; a lock that could not
  be let go is thrown away; only the last 30 days of leads are looked at · T20
- 2026-10-23 · `dev:auto-call` gives a test lead with no text conversation one,
  nothing texted. Before, the fresh lead had none, and the queue - which reads each
  lead's newest conversation - left it out even while an agent held it after a
  transfer (found on T17's real calls). Checked on a scratch database: given once,
  not again; the retry takes neither lead; the queue lists the one held
- 2026-10-18 · The server places one call on the dev number, and the webhooks name
  the call's row (T12); a robot call can be saved and is never taken for an agent's
  work (T4, migration 014)
- 2026-10-18 · To tell the client: called 1 hour after the first text, Arizona time,
  Monday to Friday; one call per lead; no email; the opening no longer says "This is
  an automated call" (they were told on 2026-10-14 it would) and now says the offer
  before asking, and the voice is a more natural one
- 2026-10-17 · Nothing left to confirm with the client before building
- 2026-10-15 · Planned, and this doc written as the agreed design and the tracker
  for building it; development on the second Twilio number the client added on
  the same account (T3), never production's
- 2026-10-13 · The client asked for the leads who never answer the texts to be called
