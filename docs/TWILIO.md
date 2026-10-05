# Browser calling (Twilio)

Phase 4, built 2026-10-01. An agent clicks **Call** in the workspace and talks
to the lead from the browser. The lead sees Secure Medical's number. A lead who
rings that number back rings their agent's browser, and a call nobody answers
becomes a text to the lead, a tag in the queue and a callback for that agent -
"Incoming calls", below. Every call, either way, is saved to `calls` and shows
on the lead's timeline.

Code: `backend/src/core/calls.ts` (the rules, pure), `db/calls.ts` (the SQL),
`integrations/twilio.ts` (the only file that uses the twilio library),
`api/calls.ts` (the browser's routes), `api/twilio-webhooks.ts` (Twilio's
routes), `twilio-settings.ts` (the settings). Screen: `frontend/src/lib/call-state.ts`,
`lib/calling.ts`, `pages/workspace/useLeadCall.ts`, `pages/workspace/CallControl.tsx`,
`CallBar.tsx`. Setup: `backend/src/cli/twilio-configure.ts`.

For incoming calls, backend: `db/missed-call-text.ts` (the text),
`db/callbacks.ts` (`finishMissedCallCallbacks`), `db/lead-state.ts`
(`MISSED_CALL_SQL`). Screen: `frontend/src/lib/incoming-state.ts`,
`lib/incoming-call.ts`, `lib/ringtone.ts` (armed from `main.tsx`),
`lib/call-notification.ts`, `lib/caller-context.ts`, `layout/IncomingCall.tsx`,
and the row on `pages/CallbacksPage.tsx`.

## How a call works

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
   the Twilio API key, valid one hour, for the identity `agent-<user id>`. It
   allows outgoing calls through our TwiML App, and lets that browser be rung
   as `agent-<user id>` (the incoming grant, added with incoming calls) -
   nothing else. The browser refreshes it before it lapses.
   `GET /api/calls/config` says whether calling is set up and which number
   leads see; it is what turns the Call button on and decides whether the
   browser listens for calls at all.
2. **The browser calls** with Twilio's Voice SDK, sending only the lead's id.
   It never sends a phone number: the server looks the number up.
3. **Twilio asks how to connect** - `POST /api/webhooks/twilio/voice`. The
   server checks the request is Twilio's (below), then, in one transaction
   (`db/calls.ts`, `startCall`):
   - the agent is active and **holds the lead** - the same rule as every other
     write on a lead, `AGENT-WORKSPACE.md`, "Rules";
   - the number is **not on the do-not-call list** - a DNC blocks calls as
     well as texts;
   - then it inserts the `calls` row and answers with TwiML that dials the
     lead, with `TWILIO_PHONE_NUMBER` as caller ID.

   If a check fails, nothing is recorded and the agent hears one sentence
   saying why, then the call ends. The screen stops all of these before the
   click; the server checks again because the screen is a courtesy, not the
   lock.
4. **Twilio reports the end** - `POST /api/webhooks/twilio/status`, on the
   far leg of the call (the lead's, for a call we placed), whoever hung up. `finishCall` saves the outcome,
   the talk time and `ended_at`.

Audio goes browser ↔ Twilio ↔ phone. It never passes through our server
(CLAUDE.md §2), so the server's size has no bearing on call quality.

## Incoming calls

Built 2026-10-01, the simple version Jeel asked for: when a lead calls our
number, show it to their agent; if the agent does not pick up, text the lead
that we will call back and show on screen that the call was missed. There is no
call queue and no ringing several agents - that is a later phase.

```
lead dials (480) 470-8259
   │
   ▼
Twilio ── POST /api/webhooks/twilio/incoming ──► who is this, and whose lead?
   │                                             (db/calls.ts, startIncomingCall)
   ├─ an agent to ring ──► that agent's browser rings for 20 seconds
   │        ├─ Answer ──► they talk; saved as answered, with its length
   │        └─ no answer, Decline, or the lead hangs up ──► missed
   └─ nobody to ring, or a number we hold no lead for ──► missed at once
```

### Who rings

One agent, never several:

1. **The agent holding the lead** - they are working it right now.
2. Otherwise **the agent who last called that lead** - the lead is most likely
   returning that call.
3. Otherwise nobody. A lead no agent has ever held or called has nobody whose
   call it is; it goes straight to missed and into the queue.

A deactivated agent is never rung. The caller is matched to a lead by phone
number; **a number we hold no lead for** hears the same message, is not
texted, and leaves no `calls` row - only a `call.incoming` entry in the
activity log with the number, and Twilio's request in `webhook_events`.

**The agent's browser must be open and signed in.** The app registers with
Twilio as soon as someone signs in (`lib/calling.ts`, `listenForCalls`) and
checks every 30 seconds that it still is. A closed laptop is a missed call.
There is no ringing of a mobile phone.

### A missed call

The lead hears: "Thank you for calling Secure Medical. Our team member is not
available right now, and will call you back shortly. Goodbye." Then:

| | |
|---|---|
| **The call is saved** | `calls` row with `direction = 'inbound'`, `outcome = 'missed'`, whatever Twilio called it (no-answer, busy, canceled). `agent_id` is the agent it rang, or null when it rang nobody |
| **The lead is texted** | `message_missed_call` from `settings`, sent through EZ Texting like every other text and saved in `messages`: "Secure Medical: Sorry we missed your call. Our team member is not available right now and will call you back shortly." Once per call. Not sent to a blocked number - the do-not-call check is inside the sender |
| **The lead goes to the queue** | Tagged **Missed call**, in bold, above an unread reply - unless an agent holds the lead, when the queue still says Working – name and the lead's page and the callback carry it. A closed lead is reopened by it. A lead with no score is in the queue for it too, at the bottom. `QUEUE.md`, "The tag" |
| **The agent gets a callback** | One row on their My Callbacks, under Today, first in the list and marked **Missed call** (Overdue only from the next day) - `callbacks.reason = 'missed_call'`, migration 008. The queue tag says a lead needs calling; this says whose job it is. One per lead however many times they ring. Not booked when the call rang nobody (the lead waits in the queue for anyone), for a deactivated agent, or for a number on the do-not-call list. An agent who pressed Decline gets it too: the lead was still told we would call back |
| **The agent is told** | The card on their screen becomes a notice: "Missed call · Leo M. · Rang for 20s", with **Call back**. It stays until dismissed, or until another call rings |
| **The lead's page says so** | A **Missed call** badge beside the lead's other states, in the queue's words, and a line on the timeline: "Missed call · told we will call back". It was a sentence in a yellow banner for a day; Jeel, 2026-10-01: a state of the lead is a badge, like Closed and Needs review |

**It stops being a missed call when someone gets back to them.** Any of:

| What | Detail |
|---|---|
| An agent calls the lead | From the moment the call is placed, answered or not |
| An agent texts the lead | Their own text. One EZ Texting refused does not count - it never arrived. Nor does the automated "we will call you back" text: that is the promise, not the call back |
| The lead rings again and is answered | |
| A call with them is under way | No outcome yet, started within the last 2 hours - so an agent talking to the lead is not shown Missed call (found on the first real answered call), and a row Twilio never closed cannot hide one for good. If an incoming call under way ends unanswered, that is a new missed call |
| An agent saves an outcome | Closed or DNC, after the call. They have decided what happens to the lead (2026-10-01, from the doc review: until then a lead closed without a call back stayed in the queue as Missed call) |

Until then the tag and the badge stay. Reading the lead's page does not clear
it - they asked for a person, and looking is not answering.

The first three also finish the agent's callback, whichever agent did it -
nobody ticks it off by hand - and an outcome finishes it as it finishes every
open callback. One an agent booked themselves is never finished for them. It
is finished when the call back is *placed*, not when it is answered.

`MISSED_CALL_SQL` in `db/lead-state.ts` is the one definition. The queue and
the lead card read it directly; Admin > Leads reads it through Closed - a
missed call un-closes a lead - and has no missed-call status of its own.

**What a missed call does to the lead's other states.** Its callback counts as
a callback like any other, so the lead reads Working on Admin > Leads; a
missed call that booked none (it rang nobody) does not make it Working. On
Admin > Overview neither the system's callback nor a call that only rang the
agent is that agent's activity - only what they did is.

**Not handled: a reply to the text from a lead still answering the
questions.** The text goes to any lead not on the do-not-call list, whatever
their conversation's state. A reply is an ordinary inbound text
(`STATE-MACHINE.md`): from a lead whose questions are finished it is stored
and flagged Inbound reply, which is right. From a lead still partway through,
"ok thanks" is taken as an unclear answer to the current question and gets the
clarification. Rare - a lead mid-questions has not been called by us - and
left as it is.

**Recorded twice over, on purpose.** How the ring ended is reported by Twilio
on the agent's leg (`/status`) and again when it asks what to say to the lead
(`/incoming/after`). An agent with no browser open may have no leg to report
on, and a lead who hangs up never reaches the second. Whichever arrives first
records the missed call and sends the text; the other finds it done and does
nothing.

### On the screen

`layout/IncomingCall.tsx`, mounted once in the app shell, so it appears on
whichever page the agent is on.

**A card in the top right corner, which says who it is before the agent
picks up** - Jeel's design, 2026-10-01, replacing the first version's bar at
the foot of the screen that showed only a name and a number.

```
● INCOMING CALL                         0:09
[LM] Leo M.                           [WARM]
     (555) 010-0014
📞 Calling back · you tried 2× today
Score       Interest     Flow
45 / 100    Both         Stopped at Q2
[ Decline ]              [ Accept ]
Accepting opens Leo's workspace and assigns the lead to you.
```

| On the card | From |
|---|---|
| Name, number | Sent with the call, so they show the instant it rings |
| How long it has rung | Counted in the browser |
| Tier, score, interest (question 1), flow | The lead card, `GET /api/leads/:id`, fetched as it starts to ring. The same words as the lead's page |
| "Calling back · you tried 2× today" | The lead's timeline: calls we placed today, by this agent or - named - by another; otherwise when we last called. Nothing when we never have. `lib/caller-context.ts` |
| The last line | Drops "and assigns the lead to you" when the agent already holds it |

The card is up at once and the details fill in a moment later; if they cannot
be loaded it still rings and can still be accepted.

- **Accept:** the call connects, the lead is picked up for the agent if it is
  not already theirs, and its page opens. From here it is an ordinary call:
  the call bar at the foot of the screen - clock, Mute, Keypad, End - and
  then the note box.
- **Decline:** the lead gets the missed-call message and text. The card goes
  away rather than saying "missed" - the agent chose it - but the lead is
  tagged Missed call in the queue all the same, once the agent lets go of it.
- **Not picked up:** the card becomes a small notice in the same corner -
  "Missed call · Leo M. · Rang for 20s" - with
  **Call back** and a close button. It stays until one is pressed or another
  call rings. It does not say the lead was texted: a blocked number, or EZ
  Texting refusing, means they were not. Call back picks the lead up, opens
  its page and dials - once; a reload or Back does not ring them again. If
  another agent picked the lead up first, or the number is on the do-not-call
  list, the page opens and nothing is dialled.
- **Focus is not moved to the card.** An agent typing a text must not answer
  a call with the space bar.
- **One call at a time.** While an agent is on a call, a second caller is not
  shown to them and gets the missed-call path - after ringing out its 20
  seconds, since Twilio's SDK ignores a call to a busy browser rather than
  refusing it. The lead's own Call button is off while an incoming call is
  ringing or live.

**It rings.** `lib/ringtone.ts` plays the app's own ringtone - a short melody
of eight soft, mallet-like notes, a pause, and again - for as long as the card
is up. (The first version played a phone line's two-tone ring, which to the
agent sounded like *they* were calling someone - Jeel, 2026-10-01. The tune is
our own and is made in the browser; there is no sound file.) Meanwhile
the browser tab's title reads "Incoming call". Twilio's built-in ringtone is
switched off: it did not sound on the first real calls (2026-10-01), and a
call the agent cannot hear is a missed call. The states are `lib/incoming-state.ts`,
pure and tested; the store that joins them to Twilio is `lib/incoming-call.ts`.

**How it is played, and why - Safari.** The melody is computed once into a WAV
in memory and looped by an ordinary `<audio>` element. It was first played
through the Web Audio API, note by note: that rang in Chrome and was silent in
Safari, which showed its speaker icon and played nothing, whether the audio
was created before the first click or inside it (two attempts, 2026-10-01).
An audio element is what every browser plays the same way. The first click
anywhere - the sign-in button counts, `main.tsx` arms it for the whole app -
plays it muted and at zero volume for an instant - Safari let the first notes
through with muted alone - which is what lets it play aloud later with nobody
clicking. Checked in Chrome: it decodes, rings, loops and stops. Confirmed by ear in Safari by
Jeel, the same day.

**A browser will not play sound on a page nobody has clicked on.** Signing in
counts as a click; a reload does not. So after a reload the corner shows
"Call sound off · click to turn on" until the agent
clicks or presses a key, and then it goes. A call arriving before that click
still shows its card, silently.

**And a desktop notification** - `lib/call-notification.ts`: "Incoming call ·
Leo M.", shown by the operating system with its own sound. It reaches an
agent whose browser is behind another window or minimised, and one whose page
cannot ring yet. The browser asks the agent's permission once, on their first
click after signing in; refused, the card and the ring still work. It closes
when the ring ends, and clicking it brings the app to the front.

**Not from the design: the "Unknown caller" card.** The design also shows a
card for a number that is not in our leads, with "You can create one after the
call". It is not built. A caller we hold no lead for rings nobody - there is no
agent whose call it is - and the app has no way to create a lead by hand:
leads come from EZ Texting. Both are decisions, not styling.

### What it needs on the Twilio account

The phone number's Voice URL must be `PUBLIC_URL/api/webhooks/twilio/incoming`.
`npm run twilio:configure` sets it, along with the TwiML App. A number that
already sends its calls somewhere else is left alone unless `--take-over` is
passed.

**One number rings one deployment.** Running `twilio:configure` locally
against the number production uses takes production's incoming calls until it
is run there again. Admin > Overview shows it: the **Calling** check turns
Degraded within a minute when the number or the TwiML App stops pointing at
the server (`LOGGING.md`, "Health endpoint"). Run it on the server after any local testing with that
number.

### Not covered

- **Voicemail.** A missed caller hears the message and the call ends. Nothing
  is recorded.
- **Nobody is rung for a lead no agent has touched.** It becomes a missed call
  and waits in the queue. Ringing whoever is free needs agent presence, which
  is the later queue work.
- **A second device.** An agent signed in on two browsers rings on both;
  the first to answer takes it.
- **A stale ring.** If neither of Twilio's two reports arrives, the row keeps
  `ended_at` null and reads "Incoming call · ringing". Not seen in testing.
- **A blocked number that rings.** No text, no callback, and it is not in the
  queue - but the lead's page still shows the Missed call badge.
- **The lead's place in the queue.** A lead with no score who rings is in the
  queue, at the bottom; past 100 rows it would be cut off.

## Voicemail

Approved by leadership 2026-10-02, after a real test call that went to
voicemail was saved as `answered`. To Twilio a phone that picks up has
answered, whoever or whatever picked up.

**Twilio's answering machine detection** listens to the first seconds after
the lead's phone picks up and reports who it was. It is switched on for every
call we place, on the `<Number>` in the TwiML (`machineDetection="Enable"`),
and Twilio posts its verdict to `POST /api/webhooks/twilio/answered-by`.

| Twilio says | Saved as `answered_by` | The call's outcome |
|---|---|---|
| `human` | `human` | `answered` |
| `machine_start` (any `machine_*`) | `machine` | **`voicemail`** |
| `fax` | `fax` | **`voicemail`** - it picked up, and it is not the lead |
| `unknown` | `unknown` | `answered` - Twilio was not sure, and we do not guess |
| nothing - nobody picked up | null | `no_answer`, `busy`, `failed`, `canceled`, as before |

- **The agent hears no difference.** They are connected the moment the phone
  picks up; detection runs beside the call. What changes is what is saved.
  Twilio's documentation does not say whether detection delays the connection
  on a dialled number, so it was checked on a real answered call, 2026-10-02:
  no pause, both sides heard each other at once.
- **The verdict and the end of the call arrive in either order.** Detection
  takes a few seconds, and a short call can be over first. `finishCall` reads
  a verdict that is already there; `recordAnsweredBy` corrects an `answered`
  call that has already ended. Only the first verdict counts.
- **Which call it is about is in the URL.** The report is made on the lead's
  leg and our row is keyed by the browser's, so the browser leg's id is put in
  the callback address (`?call=`). The address is part of what Twilio signs,
  so it cannot be pointed at another call.
- **`duration_sec` is kept** for a voicemail: it is how long the agent's
  message ran.
- **On screen:** the timeline and the conversation read "Outbound call ·
  voicemail". The call bar still says "Call ended · 0:22" - the browser is
  not told the verdict.
- **A voicemail is still a call the agent placed:** it makes the lead Working,
  and it returns a missed call.
- **Recorded:** `call.answered_by` in the activity log, with the verdict and -
  when it changed an `answered` call to `voicemail` - what the row said before.
- **It costs** Twilio's detection fee on every call we place, about $0.0075.
- **It can be wrong.** Twilio says so: a two-second greeting can be taken for
  a person, and a person who answers with a long sentence for a machine. The
  verdict is kept as `answered_by` so a wrong one can be seen.

**Two real calls, 2026-10-02**, from the browser to Jeel's own phone:

| Call | Twilio's verdict | After | Saved as |
|---|---|---|---|
| Sent to voicemail with the side button | `machine_start` | 3.4 s | `voicemail`, 22 s |
| Answered, "hello", a few words | `unknown` | 5.8 s | `answered`, 13 s |

The second is worth knowing: a real person was not reported as `human` but as
`unknown`. That is why `unknown` stays `answered` - treating it as a machine
would have filed a real conversation as voicemail.

Not covered: leaving a recorded message automatically (voicemail drop), and
anything for calls a lead places to us.

## Recordings and transcripts

Asked for by the client, 2026-10-02 ("let have them transcribed"). Every call,
placed or received, is recorded by Twilio and turned into text, and the text
shows under the call - in the workspace conversation and on the Lead Timeline,
closed until someone opens it:

```
Outbound call · answered · 0:47 · Maya Chen · 4:23 PM
▾ Transcript
  Maya Chen   Hi Priya, it's Maya from Secure Medical.
  Lead        Yes, I filled in the form. What do you provide?
```

**Switched on by one optional setting,** `TWILIO_TRANSCRIPTION_SERVICE_SID` -
Twilio's transcription service, `GA…`. It is apart from the seven: without it
calls work exactly as before and nothing is recorded. `npm run
twilio:configure -- --transcription` creates the service once (US English,
Twilio's "data logging" left off - our calls are not used to train its models)
and prints the id for `.env`.

**How a call becomes text:**

1. The `<Dial>` records from the moment the call is answered, in two channels:
   the call's first leg on channel 1, the dialled leg on channel 2. The agent
   and the lead are apart, so the transcript can say who said what.
2. Twilio posts `POST /api/webhooks/twilio/recording?call=<sid>` when the
   recording is ready. We keep its id against the call (`call_recordings`) and
   put a transcript in line (`call_transcripts`, `pending`). The webhook only
   writes those two rows, so it answers Twilio at once.
3. The worker, every 30 seconds (`worker/transcripts.ts`), asks Twilio's
   transcription service for any `pending` one, then asks after it until it
   is done - in testing, under a minute for a 47-second call. The sentences are
   stored with their speaker, worked out from the channel and who called whom
   (`core/transcripts.ts`): a call we placed has the agent on channel 1, a call
   the lead placed has the lead there.
4. If Twilio will not start one, it is tried again on each tick, five times,
   then marked failed. One Twilio is still working on after six hours is given
   up. The screen then says "Transcript not available".

**What is kept where.** The audio stays at Twilio; we keep its id
(`recording_sid`) and length. The text is kept in our database, so the
timeline does not ask Twilio each time. Neither row is rewritten once
complete. Every step - recorded, transcribed, failed - is in the activity log.

**No recording announcement - Jeel's decision, 2026-10-02.** Leads are not
told the call is recorded. Some US states require everyone on a call to agree
to being recorded; this was raised and decided knowingly. Adding one later is
a `<Say>` before the call connects.

**Cost**, Twilio's US prices on 2026-10-02: recording $0.0025 a minute,
storage $0.0005 a minute a month, transcription $0.024 a minute - about three
cents for each minute of call.

**First real call, 2026-10-02:** Jeel called his own phone and played both
sides. The recording and the transcript came through, with each side under the
right name. Both sides were in one room, so each microphone also picked up the
other: some sentences appear twice, once under each speaker. On a real call,
in two places, that does not happen.

**Not covered:** playing the audio in the app (the recording is at Twilio, and
playing it needs a proxy route - not asked for); recording a call that rang
nobody (there is nothing to record); a transcript in any language but US
English; redacting card numbers or other personal details from the text
(Twilio can, `autoRedaction` on the service - not switched on).

## What is saved

One row in `calls` per call. Outgoing calls needed no migration - the table
has been in `001_init.sql` since Week 1. Incoming calls added `direction` and
made `agent_id` optional for them (migration 007).

| Column | Value |
|---|---|
| `twilio_call_sid` | Twilio's id for the call's **first** leg: the browser's for a call we placed, the lead's for one we received. Unique, which is what makes a retried webhook safe |
| `direction` | `outbound` - an agent called the lead - or `inbound`, the lead called us |
| `agent_id`, `lead_id` | Who called whom. For an incoming call, the agent it rang - null when it rang nobody. An outgoing call always has an agent; the database refuses one without |
| `started_at` | When Twilio asked us how to connect it |
| `ended_at` | When Twilio reported the far leg ended - the lead's for a call we placed, the agent's for one we received - or at once for an incoming call that rang nobody. Null while the call is in progress |
| `outcome` | `answered`, `no_answer`, `busy`, `failed` or `canceled` - `core/calls.ts` - and `missed` for an incoming call nobody answered. Null while in progress |
| `answered_by` | Who picked up a call we placed: `human`, `machine`, `fax` or `unknown` - "Voicemail", above. Null for an incoming call, one nobody picked up, or one from before migration 010 |
| `duration_sec` | Seconds of conversation. 0 unless answered |

| Twilio says | We record |
|---|---|
| `completed` | `answered` - or `voicemail`, when detection says a machine picked up |
| `no-answer` | `no_answer` |
| `busy` | `busy` |
| `failed` | `failed` |
| `canceled` | `canceled` - the agent hung up while it was ringing |

**Both writes are idempotent.** Twilio retries a webhook that is slow to
answer. A repeated voice request carries the same CallSid: the insert does
nothing and the call is connected again. A repeated or late status report
finds `ended_at` already set and changes nothing - the first outcome stands.

**A call an agent placed or answered makes its lead Working** on Admin > Leads,
and counts as the agent's latest activity on Overview (`db/lead-state.ts`,
`db/admin-overview.ts`). A missed incoming call is the lead's doing, not an
agent's work, so it does neither by itself - "What a missed call does to the
lead's other states", above. Overview shows no call totals - they were removed
on 2026-09-28 at Jeel's request and are not back.

## Why the webhooks can be trusted

They are unauthenticated - Twilio has no session - but Twilio signs every
request: `X-Twilio-Signature` is an HMAC of the exact URL it requested plus the
posted fields, keyed with our auth token. `isFromTwilio` checks it; anything
unsigned or mis-signed gets 403 before the database is touched.

**The URL is rebuilt from `PUBLIC_URL`, not from the request.** Behind Caddy or
a tunnel, Express sees a different scheme and sometimes a different host than
Twilio called, and a signature checked against the wrong URL fails every time.
So `PUBLIC_URL` must be exactly the address Twilio uses. A wrong one shows up
as `twilio.webhook_rejected` in the logs and calls that end at once.

**The agent's identity is ours.** `From: client:agent-21` comes from the token
we signed, inside a request Twilio signed, so the agent id in it can be
trusted without a session.

With calling not set up, every Twilio webhook route answers 404.

## Settings

Seven variables. `.env.example` says where each comes from in the Twilio
Console.

| Variable | What |
|---|---|
| `TWILIO_ACCOUNT_SID` | The account, `AC…` |
| `TWILIO_AUTH_TOKEN` | Verifies webhook signatures; used by `twilio:configure` |
| `TWILIO_API_KEY`, `TWILIO_API_SECRET` | A **Standard** API key, `SK…`, and its secret. They sign the browser's token |
| `TWILIO_TWIML_APP_SID` | The TwiML App, `AP…`, whose Voice URL is our voice webhook |
| `TWILIO_PHONE_NUMBER` | The caller ID, E.164. Must be a number on the same account |
| `PUBLIC_URL` | This app's public https address, no trailing slash |

`twilio-settings.ts` reads them into one of three states:

| State | When | Effect |
|---|---|---|
| **off** | No `TWILIO_*` variable is set | The app runs as before. The Call button is off: "Calling is not set up on this server." |
| **on** | All seven are set and well-formed | Calling works |
| **incomplete** | Some are set, or one is malformed | Locally: calling is off and the API logs `calling.off` naming what is missing. **In production the API refuses to start** (`twilio_incomplete`), because a half-set configuration looks fine and fails every call |

**Point Twilio at the server** once `PUBLIC_URL` is set, and again whenever it
changes:

```bash
docker compose exec api npm run dev:twilio:configure   # local
docker compose exec api npm run twilio:configure       # production
```

It sets the TwiML App's Voice URL to `PUBLIC_URL/api/webhooks/twilio/voice`
and the phone number's to `PUBLIC_URL/api/webhooks/twilio/incoming`, and
changes nothing else on the account. "Incoming calls" above has the one thing
to watch: a number rings only one deployment.

## The screen

**A Call button, then a call bar** - Jeel's design, 2026-10-01. The lead
header has only the button (`CallControl.tsx`). Pressing it slides a dark bar
up from the foot of the screen (`CallBar.tsx`), which stays in view while the
agent scrolls the conversation or types in Wrap up. The first version turned
the header itself into the call's controls, which scrolled out of sight.

```
[PS] Priya S. (555) 010-0016        0:42   | Mute  Keypad |  End
     Connected
```

| State | The bar shows |
|---|---|
| Connecting | "Connecting…", the clock at 0:00, **End**. Mute and Keypad are off - there is nobody to mute yet |
| Ringing | "Ringing…". The agent hears real ringback |
| Live | "Connected", a running clock, **Mute**, **Keypad**, **End**. The dot on the avatar turns green |
| Ended | It becomes a **note box**: "Call ended · 2:14" (or "No answer", "Call cancelled"), a field already focused, **Save note** and **Skip** |
| Failed | A sentence the agent can act on - microphone blocked, no microphone, the call did not connect - and **Dismiss** |

**An invalid number reads "The call did not connect. The number may not be
reachable, or the connection dropped."** Twilio gives the browser one code,
31005, for both, so the sentence covers both; it said "check your internet"
until a call to a test lead's made-up 555 number showed that was the wrong
advice. The call is still recorded, as `failed`.

**The note after a call** is asked at the moment the agent knows the answer.
It is saved straight to the lead's notes - the same note Wrap up writes - so
it appears in the Notes card at once and is recorded in the activity log.
Enter saves; Skip is always there, because not every call needs a note. The
bar stays until one of them is pressed: it does not time out while someone is
typing.

**Keypad** sends tones for a phone menu or an extension, and shows what was
pressed, since a tone cannot be seen.

**The Call button is off, with the reason as a tooltip,** when the number is on
the do-not-call list, calling is not set up, or the viewer has not picked the
lead up. While a call is in progress it reads "On call".

**Leaving the lead ends the call.** `useLeadCall` hangs up when the page is
left; closing the tab mid-call asks first. The page owns the call
(`WorkspacePage.tsx`) because the button and the bar both use it.

**A call shows in the workspace** as a quiet line in the conversation -
"Outbound call · answered · 2:14 · Maya Chen · 3:02 PM" - and on the Lead
Timeline. Only an answered call shows a length.

**Twilio's SDK is its own file** (about 47 KB gzipped), fetched after the app
is on screen. Until incoming calls it loaded on the first call; a browser that
can be rung has to load it at sign-in.

The states are a pure reducer, `lib/call-state.ts`, tested without a
microphone. `lib/calling.ts` is the only file that touches the SDK.
`CallBar.test.tsx` covers the bar in every state.

## Testing

| What | Where |
|---|---|
| Settings: off, on, incomplete, malformed values | `src/twilio-settings.test.ts` |
| Identity, outcomes, talk time | `src/core/calls.test.ts` |
| The token's claims, the TwiML, the signature check | `src/integrations/twilio.test.ts` |
| Every route, refusals, a database failure, the missed-call text sent once | `src/api/__tests__/calls.test.ts` |
| The SQL: who may call, DNC, retries, the timeline; who an incoming call rings, a missed call, its effect on the queue and Admin > Leads, what settles it and what does not, and its callback - booked once, under Today, finished by a call or an answer | `scripts/calls-live-check.ts` - against a real Postgres |
| A text back finishes the missed call's callback, and not one the agent booked | `scripts/agent-sms-live-check.ts` |
| Call states, wording, error sentences | `frontend/src/lib/call-state.test.ts`, `lib/calling.test.ts` |
| The join to Twilio's SDK itself, against a stand-in for it: placing a call, being rung, accept, decline, sign-out. Added after Accept failed on the first real incoming call - the function joining a call's events to the screen called itself, and no test ran it | `frontend/src/lib/calling.device.test.ts` |
| The ring: starts, repeats, stops, stays silent while the browser blocks sound; the desktop notification | `frontend/src/lib/ringtone.test.ts`, `lib/call-notification.test.ts` |
| Incoming: ringing, answered, missed, declined, one call at a time; what the card shows; Call back | `frontend/src/lib/incoming-state.test.ts`, `lib/caller-context.test.ts`, `layout/IncomingCall.test.tsx` |

**Locally a real call needs a public address**, because Twilio must reach the
voice webhook:

```bash
cloudflared tunnel --url http://localhost:3000     # prints an https address
# put it in .env as PUBLIC_URL, then:
docker compose up -d api
docker compose exec api npm run dev:twilio:configure
```

A quick tunnel's address changes every time it starts, so repeat the last
three lines each time. Verified this way on 2026-10-01: a request signed the
way Twilio signs, sent through the tunnel, was refused unsigned (403),
connected for the agent holding the lead, refused for another agent, and its
end-of-call report saved as answered, 42 seconds.

**A real call, 2026-10-01:** Jeel picked up a lead that was his own phone and
pressed Call. The phone rang showing the client's number, was answered, and the
call was saved as `answered`, 15 seconds, with its start and end times.

**Every call on a paid account is a real call that costs money.** Test to your
own phone.

## Deploying it

1. Set the seven variables in the server's `.env`. `PUBLIC_URL=https://dailyleadhub.com`.
2. Deploy as usual (`WORKFLOW.md`, "Deploying"), including `npm run migrate` -
   incoming calls need migrations 007 and 008, voicemail detection 010,
   recordings and transcripts 011 - and for those, `TWILIO_TRANSCRIPTION_SERVICE_SID`
   in the server's `.env`, the same service as the one already made.
3. `docker compose exec api npm run twilio:configure`. Run it last, and again
   after anyone has tested locally with the same number.
4. Sign in, pick up a lead that is your own phone, press Call.
5. Call the number from that phone: the browser rings.

## What is kept as proof

- **Every signed request from Twilio** is stored as it arrived in
  `webhook_events`, before the handler runs.
- **`call.started`, `call.ended` and `call.refused`** go to the activity log. A
  refused call has no `calls` row, so the log is its only record.
- **`call.incoming` and `call.missed`** likewise. A call from a number we hold
  no lead for has no `calls` row either.

`AUDIT.md` has the whole picture.

## Not built

- **Hold.** The call bar's design has a Hold button; it is not on the screen. A
  real hold - the lead hears music and is brought back - needs the call set up
  as a conference on the server, which Phase 4 did not build, and a button
  that only muted would mislead.
- **Voicemail drop, transfer, playing a recording in the app.** Not in the
  plan. (Recording, transcripts and voicemail *detection* are built - above.) Recording needs the
  lead's consent, and is waiting on Jeel's decision.
- **A call queue for incoming calls.** One agent is rung, or nobody -
  "Incoming calls", above.
- **A stale call is not closed.** If Twilio's end-of-call report never arrives,
  the row keeps `ended_at` null and the timeline says "in progress". Not seen
  in testing; Twilio retries its callbacks.
- **Call totals on Admin > Overview.** Removed 2026-09-28, deliberately.
