# Automated outbound calls

**Planned 2026-10-15. Being built: the groundwork, T0 to T3, is done
(2026-10-17); the robot calls themselves, T4 onwards, are not built yet.** This
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

```
Q1  "Hi, this is Seri calling from eDrugstore. This is an automated call.
     Are you interested in ordering antibiotics at 25% off today?"
      YES -> "Great, connecting you with a live agent now. Please hold."  -> transfer
      NO  -> "No problem - I'll just ask one more quick thing."            -> Q2

Q2  "Can we send you a link to see all our medication at discount prices?"
      YES -> "Perfect. Check your SMS."  (link texted)
             "Thanks! You'll get the link shortly. Have a great day."      Link sent
      NO  -> "Thank you for your time. Have a great day."                  Not interested

Not understood, first time:
      "Sorry, I didn't catch that. Press 1 for yes, 2 for no, or 9 to stop these calls."
Not understood, second time:
      "Thank you for your time. Have a great day."                         No response
"Stop calling me", or 9, at any point:
      "Okay, we won't call you again. Goodbye."   (number blocked)         Opted out

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

### Understanding an answer

- A key pressed always wins: 1 yes, 2 no, 9 stop.
- Otherwise the words Twilio heard are searched for each choice's words, as
  whole words inside the sentence, longest first: "Yes, I am" and "Yeah sure"
  are Yes; "No, I'm not interested" is No. Both or neither is unclear.
- **A doubtful hearing is unclear** (Jeel, 2026-10-15): Twilio sends how sure
  it is (0-1). Below 0.4 the answer is not trusted and the question is asked
  again - with keys, which are always certain. No figure at all is not
  counted against the answer, since some speech models send none. Every
  answer's figure is kept, and 0.4 is set from the first real calls.
- "Hello?" as the call is answered is not taken as an answer: the first
  question cannot be interrupted.

### Traffic

The robot slows down and stops by itself:

- never more calls at once than there are people free;
- none while anyone is on hold;
- none when nobody is free;
- none outside 11am-5pm.

## What is saved

Nothing is overwritten (`AUDIT.md`).

| What | Where |
|---|---|
| The call | `calls`, with `direction = 'automated'`; `agent_id` empty until someone takes a transfer. `script_result`: `transferred`, `transfer_missed`, `link_sent`, `not_interested`, `opted_out`, `no_response`, `voicemail_left`, `hung_up`, `unanswered` |
| What the lead said | `call_answers`, one add-only row per answer: what Twilio heard, how sure, keys pressed, the choice it matched |
| The script | `call_scripts`, `call_steps`, `call_choices` - rows, changed by migration, like the SMS flow |
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
| T6 | The call script saved as rows | T4 | Not started |
| T7 | Understanding a spoken answer | T6 | Not started |
| T8 | What the robot does after each answer | T6, T7 | Not started |
| | **Who can take a call** | | |
| T9 | The server knows who is online | - | Not started |
| T10 | The "Taking calls" switch | T9 | Not started |
| T11 | Several browsers ringing at once | - | Not started |
| | **The call - on the dev number** | | |
| T12 | The server places one call | T3, T4, T6 | Not started |
| T13 | The questions | T7, T8, T12 | Not started |
| T14 | Text the link | T13 | Not started |
| T15 | The transfer | T10, T11, T13 | Not started |
| T16 | The hold line | T15 | Not started |
| T17 | The next free person gets the waiting lead | T16 | Not started |
| T18 | Voicemail | T12 | Not started |
| T19 | A lead calling back reaches someone | T10, T11 | Not started |
| | **Calling on its own** | | |
| T20 | The robot places the calls by itself | T12-T19 | Not started |
| | **Screens** | | |
| T21 | The timeline shows the robot calls | T13 | Not started |
| T22 | The queue puts a missed "yes" first | T15 | Not started |
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
to be confirmed on the first real transfer (T15). `CallDirection` in
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
    (25 s), hold safety stop (10 minutes), confidence threshold (0.4), and the
    texts: link text, voicemail, busy line, hold line.
- `db/call-script.ts` loads the active script.
- The link texted on "yes" is the one the SMS script already sends,
  https://www.edrugstore.com/anti-ez (Jeel, 2026-10-17).

**Done when**
- [ ] The migration runs on a copy of the database.
- [ ] A live check: editing or deleting a `call_answers` row is refused.
- [ ] A live check: a choice with both a next step and an ending is refused.
- [ ] The loader returns the script exactly as written above.

**Files:** `backend/src/db/migrations/015_call_script.sql`,
`backend/src/db/call-script.ts`, a live check.
**Doc:** this one, `SCHEMA.md`.

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
- [ ] Tests: "Yes, I am", "Yeah sure", "yes please" -> Yes.
- [ ] Tests: "No", "No, I'm not interested", "not interested" -> No.
- [ ] Tests: "Stop calling me", "remove me", "do not call", key 9 -> stop.
- [ ] Tests: "yes no", "maybe", "what is this", silence -> not understood.
- [ ] Tests: keys 1 and 2; "yes" heard with 0.2 -> not understood; with no
      figure -> Yes.
- [ ] Every SMS matching test still passes.

**Files:** `backend/src/core/answers.ts` and its test.
**Doc:** this one, "Understanding an answer".

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
- Stop -> "Okay, we won't call you again. Goodbye.", `opted_out`, and the
  number to be blocked.
- A choice -> its reply line, then its next question or its ending.
- A script that points at a question that does not exist ends the call
  politely, never loops.

**Done when**
- [ ] A test for each path: Q1 yes -> transfer; Q1 no -> Q2; Q2 yes -> link;
      Q2 no -> not interested; not understood once and twice; silence; stop
      on Q1 and on Q2; a broken script.

**Files:** `backend/src/core/call-script.ts` and its test.
**Doc:** this one.

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
  only when its Twilio connection is up.
- Signing out and deactivating an account clear it.

**Done when**
- [ ] Route tests: signed-in only; available and busy both saved.
- [ ] A live check: online; on a call (busy); signed out (cleared); silent for
      2 minutes (gone).
- [ ] A frontend test: nothing is sent while the Twilio connection is down.

**Files:** migration 016, `backend/src/api/calls.ts`, `backend/src/api/auth/routes.ts`,
`backend/src/db/users.ts`, `frontend/src/lib/calling.ts`.
**Doc:** this one, "Who is free"; `TWILIO.md`.

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
- One shared definition of **free** (`FREE_PEOPLE_SQL`): active, switch on,
  app open, not on a call. Used by every later ticket.

**Done when**
- [ ] Tests: off after sign-in and sign-out; on and off by hand; every change
      in the activity log.
- [ ] A live check: switch off -> not free; on but on a call -> not free; on,
      app open, not on a call -> free, superadmin or agent.
- [ ] The switch is hidden with `AUTO_CALLS` off.

**Files:** migration 017, `backend/src/api/calls.ts`, `backend/src/db/presence.ts`
(new), `backend/src/core/activity.ts`, `frontend/src/layout/AppShell.tsx`,
`docker-compose.yml`.
**Doc:** this one, `AUDIT.md`.

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
- [ ] Tests: a group ring taken by someone else -> nothing shown.
- [ ] Tests: a one-person ring not answered -> "Missed call", as today.
- [ ] Tests: a ring while the note is open -> the note is kept.
- [ ] Tests: the transfer card's wording.

**Files:** `frontend/src/lib/incoming-state.ts`, `frontend/src/lib/incoming-call.ts`,
`frontend/src/lib/calling.ts`, `frontend/src/layout/IncomingCall.tsx`.
**Doc:** `FRONTEND.md`, `TWILIO.md`.

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
- [ ] Route tests: signed, unsigned, calling off, the end saved.
- [ ] Jeel's phone rings showing the new number and hears question 1.
- [ ] The row is saved with its outcome and length.
- [ ] A number not on the list is refused.

**Files:** `backend/src/integrations/twilio-calls.ts`,
`backend/src/integrations/twilio.ts` (the TwiML), `backend/src/api/twilio-webhooks.ts`,
`backend/src/db/auto-calls.ts` (new), `backend/scripts/dev-auto-call.ts`.
**Doc:** this one.

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
- The result is saved once (`script_result`, only if still empty).
- Stop -> the number is blocked (`blockNumber`, new reason `call_opt_out`),
  recorded in the activity log.
- The first question cannot be interrupted, so "Hello?" is not an answer.
- A "yes" ends the call politely until T15 builds the transfer.

**Done when**
- [ ] Route tests for each path, and for the same request twice.
- [ ] Real calls: no -> Q2 -> no; silence twice; "stop calling me" (the
      number is then blocked); keys 1, 2, 9.
- [ ] Each answer is in `call_answers` with what was heard.

**Files:** `backend/src/api/twilio-webhooks.ts`, `backend/src/db/auto-calls.ts`,
`backend/src/db/dnc.ts`, `backend/src/core/activity.ts`.
**Doc:** this one, `AUDIT.md`.

---

#### T14 - Text the link

**Goal:** "yes" to question 2 texts the link, exactly once.
**Needs:** T13. **Production:** none.

**Build**
- The missed-call text sender becomes a general "send this settings text to
  this lead" (`sendSettingsText(leadId, key)`); the missed-call text uses it
  unchanged.
- On "yes": save `link_sent` first (only if the result is still empty); only
  then send the text, after Twilio has its answer.
- The text is saved in `messages` like every text; a blocked number gets
  none.

**Done when**
- [ ] Tests: the same request twice -> one text.
- [ ] Tests: a blocked number -> no text.
- [ ] The missed-call text tests still pass.
- [ ] A real call: the link arrives on Jeel's phone.

**Files:** `backend/src/db/missed-call-text.ts`, `backend/src/api/twilio-webhooks.ts`.
**Doc:** this one.

---

#### T15 - The transfer

**Goal:** a "yes" reaches a person: the lead's own agent first if free, then
everyone free.
**Needs:** T10, T11, T13. **Production:** none.

**Build**
- On "yes" (never when the call is a machine): "Great, connecting you with a
  live agent now. Please hold.", then the recording notice.
- The lead is held by someone free -> ring only them, 25 seconds. Not free,
  or not taken -> next step.
- Ring everyone free (at most 10) together for 25 seconds, carrying the lead
  and `ring=group`. No per-person end reports - the end is taken from the
  call itself.
- The first to accept: `POST .../auto/claim` makes them the lead's holder
  (taking over from anyone else, recorded with who it was taken from), saves
  them on the call, and the result `transferred`.
- Nobody accepts -> the busy line, `transfer_missed` (T16 adds the hold line
  before it).
- A free person who let it ring out, and is still free, has their switch
  turned off and sees "Missed a transfer · Taking calls off". Someone who
  started a call in those seconds keeps it on.
- Recording starts when the agent joins, as on every other call.

**Done when**
- [ ] Two browsers: A accepts -> A holds the lead, B's card clears quietly.
- [ ] Lead held by A and A is free -> only A rings first.
- [ ] Nobody accepts -> the busy line; both switches off; the result is
      `transfer_missed`.
- [ ] B on a call -> B is not rung, and B's switch stays on.
- [ ] The transfer's recording is saved.

**Files:** `backend/src/integrations/twilio.ts`, `backend/src/api/twilio-webhooks.ts`,
`backend/src/db/claims.ts`, `backend/src/db/auto-calls.ts`, `backend/src/db/presence.ts`.
**Doc:** this one, `TWILIO.md`.

---

#### T16 - The hold line

**Goal:** a "yes" that nobody took waits on hold when someone will be free
soon, and is never kept waiting for nobody.
**Needs:** T15. **Production:** none.

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
- They accept -> as in T15. They do not -> the lead goes back on hold, and
  their switch turns off as in T15.

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
- `POST .../auto/amd` - Twilio's verdict on who answered. A machine, once its
  greeting ends -> the call switches to the voicemail message (the number
  read out digit by digit), then hangs up; result `voicemail_left`.
- A fax -> hang up. A person, or not sure -> the script carries on.
- The verdict is saved as `answered_by`, as for agents' calls.
- A verdict that arrives while a transfer is ringing stops it and leaves the
  message.

**Done when**
- [ ] A real call to Jeel's voicemail: the whole message is recorded after
      the beep; "Voicemail left" is saved.
- [ ] Route tests: machine, fax, person, not sure.

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
- Places each call as in T12.

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
**Needs:** T15. **Production:** none until robot calls exist.

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
| The opening line | "Hi, this is Seri calling from eDrugstore. This is an automated call." | Jeel, as told to the client on 2026-10-14 for a scripted call |
| Calls per lead | **One.** No second try for now | Jeel, 2026-10-17 |
| The link texted on "yes" | The one the SMS script already sends: https://www.edrugstore.com/anti-ez | Jeel, 2026-10-17 |
| A "yes" nobody takes | The busy line, and the lead first in the agents' queue as "Wants a call" | Jeel, 2026-10-17 |
| Email | None anywhere: the email branch and the email line in the voicemail are dropped | Jeel, 2026-10-15 |

To tell the client: called 1 hour after the first text, Arizona time, Monday
to Friday; one call per lead; no email.

## Not in Stage 1

- The AI agent (Stage 2), from the "not understood" branch.
- A day-3 reminder text for leads still silent - a separate task once calling
  is stable, if the client agrees (Jeel, 2026-10-15).
- Sending email.
- A second call (unless the client asks for one).
- Calling in each lead's own time zone.
- A lead's own call back waiting on the hold line - only transfers wait.
