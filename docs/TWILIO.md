# Browser calling (Twilio)

An agent clicks **Call** in the workspace and talks to the lead from the
browser; the lead sees our number. Twilio connects the call, tells us how it
ended and who picked up - a person or a machine - records it when the
transcription service is set, and the worker turns the recording into a
transcript under the call. This doc is calls we place, the call bar, voicemail
detection, recordings, why Twilio's webhooks can be trusted, and calls whose
end never reached us. A lead calling our number is `INCOMING-CALLS.md`; setting
up the Twilio account, `twilio:configure` and testing on the dev number are
`TWILIO-SETUP.md`; the robot's own calls are `AUTO-CALLS.md`.

Code: `backend/src/core/calls.ts` (the rules, pure), `backend/src/db/calls.ts`
(the SQL), `backend/src/integrations/twilio.ts` (tokens, signature checks and
every TwiML), `backend/src/api/calls.ts` (the browser's routes),
`backend/src/api/twilio-webhooks.ts` (Twilio's routes),
`backend/src/api/left-open.ts` (calls whose end never came). Screen:
`frontend/src/lib/calling.ts` (the only file that uses Twilio's Voice SDK),
`frontend/src/lib/call-state.ts`, `frontend/src/pages/workspace/useLeadCall.ts`,
`CallControl.tsx` and `CallBar.tsx`.

## How it works

### How a call works

```
Agent's browser                 Our API                         Twilio                Lead's phone
     │  POST /api/calls/token      │                               │                       │
     │ ───────────────────────────►│  signs a 1-hour token         │                       │
     │ ◄─────────────────────────── │                               │                       │
     │  connect, with { leadId }   │                               │                       │
     │ ────────────────────────────────────────────────────────────►│                       │
     │                             │  POST /api/webhooks/twilio/voice  (signed)            │
     │                             │ ◄──────────────────────────────│                       │
     │                             │  agent holds the lead? number not on DNC?             │
     │                             │  records the call; answers "dial this number"         │
     │                             │ ──────────────────────────────►│  rings ──────────────►│
     │ ◄═══════════ audio: browser ↔ Twilio ↔ phone, never through our server ════════════►│
     │                             │  POST /api/webhooks/twilio/status  (signed)           │
     │                             │ ◄──────────────────────────────│  the call ended       │
     │                             │  saves outcome and talk time   │                       │
```

1. **Token.** `POST /api/calls/token`, signed-in users only. A JWT signed with
   the Twilio API key, valid one hour (`TOKEN_TTL_SECONDS`), for the identity
   `<prefix>agent-<user id>` - `identityFor` in `core/calls.ts`, the prefix
   being this server's `TWILIO_IDENTITY_PREFIX`: empty in production, so user
   21 is `agent-21`; `dev-` on a laptop, so `dev-agent-21`
   (`TWILIO-SETUP.md`, "What it needs on the Twilio account"). The token
   allows outgoing calls through our TwiML App and lets that browser be rung
   under that name - nothing else. The browser refreshes it before it lapses.
   `GET /api/calls/config` says whether calling is set up, which number leads
   see, and whether automated calls are on; it turns the Call button on and
   decides whether the browser listens for calls at all.
2. **The browser calls** with Twilio's Voice SDK, sending only the lead's id.
   It never sends a phone number: the server looks the number up.
3. **Twilio asks how to connect** - `POST /api/webhooks/twilio/voice`. The
   server checks the request is Twilio's ("Why the webhooks can be trusted"),
   reads the agent from the browser's name, then, in one transaction
   (`startCall`, `db/calls.ts`):
   - the agent is active and **holds the lead** - the rule every write on a
     lead keeps, `AGENT-WORKSPACE.md`, "Rules", rule 4;
   - the number is **not on the do-not-call list** - a block stops calls as
     well as texts;
   - then it inserts the `calls` row and answers with TwiML that dials the
     lead (`dialTwiml`), with `TWILIO_PHONE_NUMBER` as caller ID and
     `answerOnBridge`, so the agent hears real ringback and the screen's
     "Ringing" is true.

   A refused call writes no `calls` row - it is kept as `call.refused` in the
   activity log - and the agent hears one sentence saying why
   (`REFUSAL_SPEECH`), then the call ends. A request that names no lead or no
   agent, or a database failure, gets "The call could not be placed." The
   screen stops all of these before the click; the server checks again
   because the screen is a courtesy, not the lock.
4. **Twilio reports the end** - `POST /api/webhooks/twilio/status`, on the
   lead's leg, whoever hung up. Our row is keyed by the browser's leg, which
   Twilio sends as `ParentCallSid`. `finishCall` saves the outcome, the talk
   time and `ended_at`.

Calling the lead also finishes the callback a missed call left
(`finishMissedCallCallbacks`, `INCOMING-CALLS.md`, "A missed call").

### The screen

**A Call button, then a call bar.** The lead header has only the button
(`CallControl.tsx`). Pressing it slides a dark bar up from the foot of the
screen (`CallBar.tsx`), which stays in view while the agent scrolls the
conversation or types in Wrap up.

```
[PS] Priya S. (555) 010-0016        0:42   | Mute  Keypad |  End
     Connected
```

| State | The bar shows |
|---|---|
| Connecting | "Connecting…", the clock at 0:00, **End**. Mute and Keypad are off - there is nobody to mute yet |
| Ringing | "Ringing…". The agent hears real ringback |
| Live | "Connected" ("Connected · muted"), a running clock, **Mute**, **Keypad**, **End**. The dot on the avatar turns green |
| Ended | It becomes a **note box**: "Call ended · 2:14" (or "No answer", "Call cancelled"), a field already focused, **Save note** and **Skip** |
| Failed | A sentence the agent can act on - microphone blocked, no microphone, the call did not connect - and **Dismiss** (`describeCallError`, `lib/calling.ts`) |

- **An invalid number reads "The call did not connect. The number may not be
  reachable, or the connection dropped."** Twilio gives the browser one code,
  31005, for both, so the sentence covers both. The call is still recorded,
  as `failed`.
- **The note after a call** is asked at the moment the agent knows the answer.
  It is saved straight to the lead's notes - the same note Wrap up writes - so
  it appears in the Notes card at once and is recorded in the activity log.
  Enter saves; Skip is always there, because not every call needs a note. The
  bar stays until one of them is pressed: it does not time out while someone
  is typing.
- **Keypad** sends tones for a phone menu or an extension, and shows what was
  pressed, since a tone cannot be seen.
- **The Call button is off, with the reason as a tooltip** (`callBlockedReason`,
  `lib/call-state.ts`), when the number is on the do-not-call list, calling is
  not set up, or the viewer has not picked the lead up; and while an incoming
  call rings, is live, or still has its note box open ("Save or skip the last
  call's note first."). During a call it reads "On call"; otherwise its
  tooltip says the number the lead will see. Should both bars show at once -
  this lead's call over with its note open, and a lead's call taken meanwhile -
  this lead's sits above the incoming one (`raised`, `--call-bar-raise` -
  `FRONTEND-STYLE.md`), never on top.
- **The lead's call finishes once** (`useLeadCall`): its end refreshes the
  page, and once more 2.5 seconds on (`SECOND_REFRESH_MS`) - the server learns
  how the call ended from Twilio a moment after the browser does - never twice
  over, even when a failure is followed by Twilio's `disconnect`.
- **Leaving the lead ends the call.** `useLeadCall` hangs up when the page is
  left; closing the tab mid-call asks first (the SDK's `closeProtection`). The
  page owns the call (`WorkspacePage.tsx`) because the button and the bar both
  use it.
- **A call shows in the workspace** as a quiet line in the conversation -
  "Outbound call · answered · 2:14 · Maya Chen · 3:02 PM" - and on the Lead
  Timeline; only an answered call shows a length. The wordings are
  `TIMELINE.md`'s.
- **Twilio's SDK is its own chunk**, fetched after the app is on screen, at
  sign-in: a browser that can be rung has to hold a registered device
  (`INCOMING-CALLS.md`, "Being rung").

The states are a pure reducer, `lib/call-state.ts`, tested without a
microphone.

### Voicemail

To Twilio a phone that picks up has answered, whoever or whatever picked up.
**Twilio's answering machine detection** listens to the first seconds after
the lead's phone picks up and reports who it was. It is on for every call we
place, on the `<Number>` in the TwiML (`machineDetection="Enable"`), and
Twilio posts its verdict to `POST /api/webhooks/twilio/answered-by`.

| Twilio says | Saved as `answered_by` | The call's outcome |
|---|---|---|
| `human` | `human` | `answered` |
| `machine_start` (any `machine_*`) | `machine` | **`voicemail`** |
| `fax` | `fax` | **`voicemail`** - it picked up, and it is not the lead |
| `unknown` | `unknown` | `answered` - Twilio was not sure, and we do not guess |
| nothing - nobody picked up | null | `no_answer`, `busy`, `failed`, `canceled` |

- **The agent hears no difference.** They are connected the moment the phone
  picks up; detection runs beside the call, not in front of it. What changes
  is what is saved.
- **The verdict and the end of the call arrive in either order.** Detection
  takes a few seconds, and a short call can be over first. `finishCall` reads
  a verdict that is already there; `recordAnsweredBy` corrects an agent's
  `answered` call that has already ended. Only the first verdict counts.
- **Which call it is about is in the URL.** The report is made on the lead's
  leg and our row is keyed by the browser's, so the browser leg's id is put in
  the callback address (`?call=`). The address is part of what Twilio signs,
  so it cannot be pointed at another call.
- **`duration_sec` is kept** for a voicemail: it is how long the agent's
  message ran.
- **On screen** the timeline and the conversation read "Outbound call ·
  voicemail". The call bar still says "Call ended · 0:22" - the browser is not
  told the verdict.
- **A voicemail is still a call the agent placed:** it makes the lead Working,
  and it returns a missed call.
- **Recorded** as `call.answered_by` in the activity log, with the verdict and -
  when it changed an `answered` call to `voicemail` - what the row said before.
- **It can be wrong.** Twilio says so: a two-second greeting can be taken for
  a person, and a person who answers with a long sentence for a machine. The
  verdict is kept as `answered_by` so a wrong one can be seen. A real person
  answering "hello" has come back `unknown`, not `human` - which is why
  `unknown` stays `answered`: treating it as a machine would file a real
  conversation as voicemail.

The automated call acts on the verdict - it leaves a message after the beep -
and is saved as `voicemail` only when the verdict took the call over:
`AUTO-CALL-SCRIPT.md`, "Voicemail".

### Recordings and transcripts

Every call, placed or received, is recorded by Twilio and turned into text, and
the text shows under the call - in the workspace conversation and on the Lead
Timeline, closed until someone opens it (`components/CallTranscript.tsx`):

```
Outbound call · answered · 0:47 · Maya Chen · 4:23 PM
▾ Transcript
  Maya Chen   Hi Priya, it's Maya from Secure Medical.
  Lead        Yes, I filled in the form. What do you provide?
```

It is switched on by one optional setting, `TWILIO_TRANSCRIPTION_SERVICE_SID`
(`ENVIRONMENT.md`): without it calls work exactly as before and nothing is
recorded. `TWILIO-SETUP.md` has how the service is made.

1. **The `<Dial>` records** from the moment the call is answered, in two
   channels (`record-from-answer-dual`): the call's first leg on channel 1,
   the dialled leg on channel 2. The agent and the lead are apart, so the
   transcript can say who said what.
2. **Twilio posts `POST /api/webhooks/twilio/recording?call=<sid>`** when the
   recording is ready. We keep its id against the call (`call_recordings`)
   and put a transcript in line (`call_transcripts`, `pending`). The webhook
   only writes those two rows, so it answers Twilio at once.
3. **The worker, on each tick** (`worker/transcripts.ts`, `POLLER.md`), asks
   Twilio's transcription service for any `pending` one, then asks after it
   until it is done. The sentences are stored with their speaker, worked out
   from the channel and who called whom (`speakerFor`, `core/transcripts.ts`): a call an agent
   placed has the agent on channel 1; a call the lead placed, and the
   automated call's transfer, have the lead there.
4. **If Twilio will not start one**, it is tried again on each tick, five
   times (`MAX_TRANSCRIPT_ATTEMPTS`), then marked failed. One Twilio is still
   working on after six hours (`TRANSCRIPT_GIVE_UP_HOURS`) is given up. The
   screen then says "Transcript not available".

**What is kept where.** The audio stays at Twilio; we keep its id
(`recording_sid`) and length. The text is kept in our database, so the
timeline does not ask Twilio each time. Neither row is rewritten once
complete. Every step - recorded, transcribed, failed - is in the activity log.

**The lead hears a recording notice** before they are connected, on every
recorded call - the client's words, `RECORDING_NOTICE` in `core/calls.ts`:

- **A call we place:** Twilio plays it on the lead's side once they pick up,
  before the agent is connected (`<Number url>` → `POST
  /api/webhooks/twilio/notice`). The agent keeps hearing ringing for those
  seconds. A voicemail hears it too.
- **A call the lead places:** they hear it first, then the agent's browser
  rings (`ringAgentTwiml`, `ringEveryoneTwiml`).
- **Only on a recorded call** - when the transcription service is set.
- The automated call's transfer plays it too, before the ring
  (`AUTO-CALL-TRANSFER.md`, "The transfer").

### Why the webhooks can be trusted

They are unauthenticated - Twilio has no session - but Twilio signs every
request: `X-Twilio-Signature` is an HMAC of the exact URL it requested plus the
posted fields, keyed with our auth token. `isFromTwilio` checks it; anything
unsigned or mis-signed gets 403 before the database is touched, and
`twilio.webhook_rejected` in the logs.

**The URL is rebuilt from `PUBLIC_URL`, not from the request.** Behind Caddy or
a tunnel, Express sees a different scheme and sometimes a different host than
Twilio called, and a signature checked against the wrong URL fails every time.
So `PUBLIC_URL` must be exactly the address Twilio uses. A wrong one shows up
as `twilio.webhook_rejected` and calls that end at once.

**The agent's identity is ours.** `From: client:agent-21` (with this server's
prefix in front, if it has one) comes from the token we signed, inside a
request Twilio signed, so the agent id in it can be trusted without a session.
`agentIdFromIdentity` reads only this server's prefix: production does not
take `dev-agent-21` for user 21, nor a laptop `agent-21`.

With calling not set up, every Twilio webhook route answers 404.

**The automated call's webhooks** (`/auto/answer`, `/auto/gather`,
`/auto/status`, `/auto/amd`, `/auto/claim`, `/auto/after`, `/auto/hold`,
`/auto/offer`, `/auto/ai-after`) are checked the same way, and name their
call's row in the address (`?call=<id>`), which is part of what Twilio signs:
the row cannot be swapped. `/auto/claim` takes the person from `To`, our own
signed browser name, as the voice webhook does. They answer 404 while
automated calls are off. What each does: `AUTO-CALLS.md`, "How a call is
placed". Seri's relay WebSocket, `/api/ai/relay`, is checked against Twilio's
signature too, before any socket opens (`relaySigned`, `AI-RELAY.md`).

**`/incoming/claim`** - a person accepting a call back that rang everyone
free - is checked the same way and answers 404 while automated calls are off
too. It names no row in its address: it takes the lead's call from
`ParentCallSid` and the person from `To` - both in what Twilio signs - and
acts only on an incoming call still ringing with nobody on it yet
(`INCOMING-CALLS.md`, "Who rings").

### Calls whose end never came

Twilio reports a call's end to `/status` (or `/auto/status`) once. A report
that never arrives - the api restarting at a deploy as it came, for one - would
leave the row with no outcome for good: "in progress" on the timeline, "No
result" on Admin > Leads, and a person who took it counted as on a call for two
hours (`ON_A_CALL_SQL`), every "yes" waiting on hold meanwhile.

So every call Twilio placed - an agent's, a lead's, the robot's - still open
15 minutes after it started (`LEFT_OPEN_MINUTES`) is asked about every 5
minutes (`LEFT_OPEN_CHECK_MS`, `watchLeftOpen`, `api/left-open.ts`, with
calling set up): Twilio's own record of it (`callEnd`,
`integrations/twilio-calls.ts`), and a call Twilio says is over is ended as its
own report would have ended it - `finishCall`, then `settleAutomatedCall` for
the robot's (`closeFromTwilio`, shared with the hold watcher, which ends a
held call the same way). `call.closed_late` (warn) says one was. A call still
going is left alone and asked again 5 minutes on; Twilio not answering, the
same. No text goes with a missed call found this way - it is minutes late; its
call back is booked as for any missed call. The calls' query is
`callsLeftOpen` (`db/calls.ts`), oldest first, 50 a look. An automated call
that never reached Twilio is closed by the dialler instead
(`closeUnplacedCalls`, `AUTO-CALLS.md`).

## Rules

1. **Only the agent holding the lead calls it**, from an active account, to a
   number not on the do-not-call list - checked by the voice webhook in one
   transaction with the lead row locked, whatever the screen allowed.
2. **The browser never sends a phone number.** It sends the lead's id; the
   server looks the number up.
3. **Audio never passes through our server** - browser ↔ Twilio ↔ phone - so
   the server's size has no bearing on call quality.
4. **Every Twilio webhook is signed and checked** against `PUBLIC_URL` before
   the database is touched; unsigned is 403, calling off is 404.
5. **Only the first report counts.** A repeated voice request carries the same
   CallSid: the insert does nothing and the call is connected again. A
   repeated or late status report finds `ended_at` already set and changes
   nothing. Only the first verdict on who picked up is kept.
6. **A machine's verdict makes an agent's call `voicemail`; `unknown` stays
   `answered`.**
7. **A call is recorded only when the transcription service is set**, and then
   the lead hears the recording notice before anyone is connected.
8. **A refused call writes no `calls` row**: `call.refused` in the activity
   log is its only record.
9. **Leaving the lead ends the call.**

## Data

One row in `calls` per call; `call_recordings` and `call_transcripts` for its
recording and text. Every column, its meaning and its constraints are in
`SCHEMA.md`.

### What is saved

- **`twilio_call_sid`** is Twilio's id for the call's **first** leg: the
  browser's for a call we placed, the lead's for one we received. Unique,
  which is what makes a retried webhook safe.
- **`direction`** is `outbound` for a call an agent placed - `inbound` and
  `automated` are `INCOMING-CALLS.md`'s and `AUTO-CALLS.md`'s. An agent's call
  always has an agent: the database refuses one without
  (`calls_outbound_has_agent`).
- **`started_at`** is when Twilio asked us how to connect it; **`ended_at`**
  when Twilio reported the lead's leg ended. Null while the call is in
  progress.
- **The outcome** is mapped from Twilio's status in `core/calls.ts`
  (`outcomeForStatus`), then corrected by the verdict ("Voicemail"):

| Twilio says | We record |
|---|---|
| `completed` | `answered` - or `voicemail`, when detection says a machine picked up (an automated call only when the verdict took it over) |
| `no-answer` | `no_answer` |
| `busy` | `busy` |
| `failed` | `failed` |
| `canceled` | `canceled` - the agent hung up while it was ringing |

- **`duration_sec`** is seconds of conversation: 0 unless answered
  (`talkSeconds`), and kept for a voicemail.
- **A call an agent placed or answered makes its lead Working** on Admin >
  Leads (`ADMIN-LEADS.md`) and counts as the agent's latest activity on
  Overview (`ADMIN.md`) - `WORKED_SQL`, `db/lead-state.ts`. An automated call
  nobody took does neither: no person was on it.

### What is kept as proof

Every signed request from Twilio is kept as it arrived in `webhook_events`,
before the handler runs; `call.started`, `call.ended`, `call.refused`,
`call.answered_by`, `call.recorded`, `call.transcribed` and
`call.transcript_failed` go to the activity log. Which action carries what, and
why a refused call's log row is its only record:
[`AUDIT.md`](AUDIT.md). Log events (`call.*`, `twilio.*`, `transcript.*`) are
in `LOGGING.md`.

## Code

| File | What it does |
|---|---|
| `backend/src/core/calls.ts` | Pure: the browser's name (`identityFor`, `agentIdFromIdentity`), outcomes (`outcomeForStatus`, `talkSeconds`), the verdict (`answeredByFor`), refusals (`REFUSAL_SPEECH`), `RECORDING_NOTICE` |
| `backend/src/db/calls.ts` | `startCall`, `finishCall`, `recordAnsweredBy`, `callsLeftOpen`; and a lead's call to us (`INCOMING-CALLS.md`) |
| `backend/src/integrations/twilio.ts` | `mintCallToken`, `isFromTwilio`, `dialTwiml`, `recordingNoticeTwiml`, `refusalTwiml`; the webhook paths (`VOICE_PATH`, `STATUS_PATH`, `AMD_PATH`, `RECORDING_PATH`, `NOTICE_PATH`) |
| `backend/src/integrations/twilio-calls.ts` | `callEnd` - Twilio's own record of a call, for a call left open |
| `backend/src/api/calls.ts` | `GET /api/calls/config`, `POST /api/calls/token`; the browser's `ringable` word and the "Taking calls" switch (`AUTO-CALL-TRANSFER.md`) |
| `backend/src/api/twilio-webhooks.ts` | `/voice`, `/status`, `/answered-by`, `/recording`, `/notice`; the signature check and the raw archive for every route |
| `backend/src/api/left-open.ts` | `watchLeftOpen`, `closeLeftOpen`, `closeFromTwilio` - wired in `api/index.ts` |
| `backend/src/twilio-settings.ts` | Reads calling's settings: off, on or incomplete (`TWILIO-SETUP.md`, "Settings") |
| `backend/src/core/transcripts.ts` | Who said what (`speakerFor`), the retry limits |
| `backend/src/db/transcripts.ts`, `backend/src/worker/transcripts.ts`, `backend/src/integrations/twilio-transcripts.ts` | Recordings and transcripts: saved, asked for, read back |
| `frontend/src/lib/calling.ts` | The only file that uses the SDK: `placeCall`, `describeCallError`; being rung (`INCOMING-CALLS.md`) |
| `frontend/src/lib/call-state.ts` | A call's states, pure; `callBlockedReason`, `endedText`, `occupiesAgent` |
| `frontend/src/pages/workspace/useLeadCall.ts` | One lead's call, ended when the page is left |
| `frontend/src/pages/workspace/CallControl.tsx`, `CallBar.tsx` | The Call button; the call bar and its note box |
| `frontend/src/styles/call-bar.css` | The call bar's look, and a second bar docked above the first |
| `frontend/src/components/CallTranscript.tsx` | A call's transcript, under the call |

## Tests

| What | Where |
|---|---|
| Settings: off, on, incomplete, malformed values, the identity prefix | `backend/src/twilio-settings.test.ts` |
| Identity (with and without a prefix), outcomes, talk time | `backend/src/core/calls.test.ts` |
| Who said what in a transcript | `backend/src/core/transcripts.test.ts` |
| The token's claims, the TwiML, the signature check | `backend/src/integrations/twilio.test.ts` |
| Every route, refusals, a database failure, the recording notice, a recording ready | `backend/src/api/__tests__/calls.test.ts` |
| A call left open: ended from Twilio's record, left alone while it goes on, one failure never stopping the rest | `backend/src/api/left-open.test.ts` |
| The SQL: who may call, the do-not-call list, retries, the timeline, voicemail, recordings and transcripts, calls left open | `backend/scripts/calls-live-check.ts` - against a real Postgres (`TESTING.md`) |
| Call states, wording, error sentences | `frontend/src/lib/call-state.test.ts`, `frontend/src/lib/calling.test.ts` |
| The join to Twilio's SDK itself, against a stand-in for it: placing a call, being rung, accept, decline, sign-out | `frontend/src/lib/calling.device.test.ts` |
| The call bar in every state, and its note box | `frontend/src/pages/workspace/CallBar.test.tsx` |
| The lead's call on the workspace: refreshed once and once more, never twice over; a failure then a disconnect; Hang up while connecting; one call at a time, a new one once the last is over; leaving the lead ends it; a call that could not be placed | `frontend/src/pages/workspace/useLeadCall.test.ts` |
| The transcript under a call | `frontend/src/components/CallTranscript.test.tsx` |

## Not done

- **Hold.** The call bar's design has a Hold button; it is not on the screen. A
  real hold - the lead hears music and is brought back - needs the call set up
  as a conference on the server, and a button that only muted would mislead.
- **Voicemail drop and transfer on an agent's call.** Not in the plan. The
  automated call has both - a transfer to a person and a voicemail message
  (`AUTO-CALLS.md`).
- **Playing the recording in the app.** The audio is at Twilio, and playing it
  needs a proxy route - not asked for.
- **A transcript in any language but US English.**
- **Recording a call that rang nobody** - there is nothing to record.
- **Redacting card numbers or other personal details from the text.** Twilio
  can (`autoRedaction` on the service); it is not switched on.
- **A call closed from Twilio's record is ended from the call's first leg**,
  not the far leg `/status` reports on: the browser's for an agent's call, the
  lead's for a call to us. Twilio reports that leg `completed` once our TwiML
  answered it, so such a call may be saved `answered` whoever picked up. Not
  seen on a real call.
- **Call totals on Admin > Overview** - removed deliberately (`ADMIN.md`).
  Every call is on its lead's timeline.

## Decisions

| Decision | By | Date |
|---|---|---|
| The Call button in the lead header; the call itself in a bar docked at the foot of the screen that becomes a note box | Jeel | 2026-10-01 |
| Twilio's answering machine detection on every call we place | Client | 2026-10-02 |
| Every call recorded and transcribed | Client | 2026-10-02 |
| No recording notice | Jeel | 2026-10-02 |
| A recording notice before every recorded call, in the client's words - replacing the one above | Client | 2026-10-05 |
| Never run `twilio:configure` from a laptop with production's number or TwiML App (`TWILIO-SETUP.md`) | Jeel | 2026-10-05 |
| Local calling on its own number, TwiML App and identity prefix - never production's | Jeel | 2026-10-16 |
| No call totals on Admin > Overview | Jeel | 2026-09-28 |

## History

- 2026-11-27 · Rewritten to the area template: a lead calling us moved to `INCOMING-CALLS.md`; the account, settings, `twilio:configure`, local testing and deploying moved to `TWILIO-SETUP.md`; the browser's name given with its prefix (`identityFor`); the notice's own words, Twilio's prices and the legal reason for the notice taken out - they are the client's to state, and the words stay in `core/calls.ts` · the docs standard · D38, D39
- 2026-11-23 · The lead's call refreshes the page once, and once more, never twice over · a failed call followed by Twilio's `disconnect` ended it again - two refreshes and two more; `useLeadCall` had no test and got them · review Q7
- 2026-11-22 · Calls whose end never came: every call still open 15 minutes after it started is asked of Twilio every 5 minutes and ended from its record. Before, a lost report left the call open for good, and an agent's stale call was listed as not closed under "Not built" · review H4 (`REVIEW-2026-11-22.md`)
- 2026-11-22 · The Call button off while an incoming call's note box is open, and a second call bar sits above the first · two bars could overlap · review M26
- 2026-10-24 · The recording notice cut short by a voicemail's beep, on the automated call's transfer - the message left instead · T18
- 2026-10-20 · The automated call's transfer is transcribed with the lead on channel 1, checked on a real one · T15a
- 2026-10-18 · `calls.direction` can be `automated` (migration 014); the automated call's webhooks are checked like these · T4, T12
- 2026-10-17 · The recording notice heard on real calls on the dev number - the automated call's transfers, where it was timed · T15a
- 2026-10-05 · The recording notice played before every recorded call. Until then none was played · Client
- 2026-10-02 · Recordings and transcripts: every call recorded in two channels and transcribed by Twilio's service; `npm run twilio:configure -- --transcription` makes the service · asked for by the client · migration 011. The first real call - Jeel calling his own phone and playing both sides - came through with each side under the right name; both sides were in one room, so each microphone picked up the other and some sentences appear twice, which two places on a real call do not do. A 47-second call was transcribed in under a minute
- 2026-10-02 · Voicemail detection on every call we place · a real test call that went to voicemail had been saved `answered` · approved by the client · migration 010. Checked on a real answered call: no pause, both sides heard each other at once - Twilio's documentation does not say whether detection delays a dialled number. Two real calls to Jeel's phone: sent to voicemail with the side button - `machine_start` after 3.4 s, saved `voicemail`, 22 s; answered with "hello" and a few words - `unknown` after 5.8 s, saved `answered`, 13 s
- 2026-10-01 · Browser calling built - Phase 4: the token, the voice webhook, the status callback; `calls` had been in `001_init.sql` since Week 1, so outgoing calls needed no migration, and incoming calls added `direction` and made `agent_id` optional (migration 007). Verified through a tunnel: a request signed the way Twilio signs was refused unsigned (403), connected for the agent holding the lead, refused for another agent, and its end saved as answered, 42 s. Then a real call: Jeel picked up a lead that was his own phone and pressed Call; the phone rang showing the client's number, was answered, and was saved `answered`, 15 s · Jeel
- 2026-10-01 · The Call button and a call bar at the foot of the screen · the first version turned the header itself into the call's controls, which scrolled out of sight · Jeel
- 2026-10-01 · Twilio's SDK, about 47 KB gzipped, loaded at sign-in · before incoming calls it loaded on the first call
- 2026-10-01 · The 31005 sentence: "check your internet" became "The number may not be reachable, or the connection dropped" · a call to a test lead's made-up 555 number showed the old advice was wrong
- 2026-09-28 · Call totals removed from Admin > Overview · Jeel
