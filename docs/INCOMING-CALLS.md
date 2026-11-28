# Incoming calls

When a lead rings our number, the browser of the agent whose lead it is rings:
the agent holding the lead, or else the agent who last called them. With
automated calls on, a lead with no agent of its own - one returning the
robot's voicemail, most often - rings everyone free together, and the first to
accept takes the call and the lead. When nobody answers, the lead hears that we
will call back, is texted the same, goes to the queue as a missed call, and the
agent it rang gets a callback. There is no call queue. Code:
`backend/src/db/calls.ts` (`startIncomingCall`, `takeIncomingCall`),
`backend/src/api/twilio-webhooks.ts` (`/incoming`, `/incoming/after`,
`/incoming/claim`), `backend/src/integrations/twilio.ts` (`ringAgentTwiml`,
`ringEveryoneTwiml`); on the screen `frontend/src/layout/IncomingCall.tsx` and
the `frontend/src/lib/` files under "Code". Calls we place, the call bar,
recordings and webhook signatures are `TWILIO.md`.

## How it works

```
lead dials (480) 470-8259
   │
   ▼
Twilio ── POST /api/webhooks/twilio/incoming ──► who is this, and whose lead?
   │                                             (db/calls.ts, startIncomingCall)
   ├─ an agent to ring ──► that agent's browser rings for 20 seconds
   │        ├─ Answer ──► they talk; saved as answered, with its length
   │        └─ no answer, Decline, or the lead hangs up ──► missed
   ├─ nobody's, automated calls on ──► everyone free rings, 20 seconds
   │        ├─ one accepts ──► theirs (/incoming/claim); saved as answered
   │        └─ nobody accepts, or the lead hangs up ──► missed
   └─ nobody to ring, or a number we hold no lead for ──► missed at once
```

On a recorded call the lead hears the recording notice first, then the ring
begins (`TWILIO.md`, "Recordings and transcripts"). A ring lasts
`INCOMING_RING_SECONDS`, 20 - long enough to finish a sentence and click,
short enough that the lead is not left listening to ringing.

### Who rings

1. **The agent holding the lead** - they are working it right now.
2. Otherwise **the agent who last called that lead** - the lead is most likely
   returning that call. An automated call counts once a person took its
   transfer; one nobody took has no agent and is skipped. Only active accounts
   count, at both steps: a holder who was deactivated is passed over, and so
   is a last caller - the latest call by someone still active rings them, even
   when someone since deactivated called after.
3. Otherwise, **with automated calls on, everyone free together** - `FREE_SQL`
   (`AUTO-CALL-TRANSFER.md`, "Who is free"): the "Taking calls" switch on, a
   browser open and not busy, no call going; at most ten
   (`MAX_RUNG_AT_ONCE`), the first ten by account, lowest id first. A lead
   the robot's voicemail asked to call back has no agent of its own. The first
   to accept takes it.
4. Otherwise nobody. A lead no agent has ever held or called has nobody whose
   call it is; it goes straight to missed and into the queue. With automated
   calls off, step 3 is skipped.

The first two are rung switch or not, and alone: it is their lead, or their
call being returned. A ring they miss is a missed call - their callback - not
passed on to everyone free.

**A ring to everyone** (`ringEveryoneTwiml`): each browser is marked
`ring=group`, so a ring someone else took clears with no "Missed call", and a
busy browser turns it down ("A ring that goes to several people"). The call's
row has no `agent_id` while it rings. Whoever accepts runs
`POST /api/webhooks/twilio/incoming/claim` on their leg, before they are
connected: the call becomes theirs (`takeIncomingCall`, `call.taken`) and so
does the lead, taken over from anyone who held it (`lead.picked_up`,
`via: 'call_back'`, `takeCallWithLead` in `db/claims.ts`) - first come, once;
a second accept, or a deactivated account, is hung up. Their browser picks the
lead up too as it accepts, and that can arrive first; but in two accepts at
once it could be the other person's - so the lead follows the call. Only with
automated calls on; `/incoming/claim` answers 404 otherwise.

**How a ring to everyone ended comes from the whole ring** -
`/incoming/after?ring=group` - and nothing else: no browser reports its own
end, as for a transfer (`AUTO-CALL-TRANSFER.md`, "The transfer"). Twilio
reports a ring cut short by someone else's answer as `no-answer`, exactly like
one let run out, and a second accept it refused and hung up as `completed`,
like the call itself; acting on either would end a call someone is on. So
`completed` counts as taken only when the call is someone's
(`incomingTakenBy`): one whose only accept was refused - a deactivated
account, a call no longer ringing - is a missed call like one let run out; the
lead hears we will call back and is texted (`call.ring_not_taken`). The
database failing to say counts as taken: the lead may be talking to them.
Twilio asks `/incoming/after` however it ends - taken and over, run out, or the
lead hanging up while it rang. Letting a call-back ring run out turns nobody's
switch off - only a transfer does.

**Twilio asking again** about the same call keeps the first decision: a call
that is over stays over (nobody rung, not texted again), one agent's ring
rings them again, and a ring to everyone rings whoever is free now - nobody
free now, it is missed at once and texted, never left open with nothing
ringing.

**Taking a call back is not calling the lead.** Step 2 counts calls we placed;
whoever took a call back holds the lead instead (step 1). Once they release
it, the next call back rings everyone free again.

**A number we hold no lead for** hears the same missed-call message, is not
texted, and leaves no `calls` row - only a `call.incoming` entry in the
activity log with the number (`known: false`), and Twilio's request in
`webhook_events`. The caller is matched to a lead by phone number.

**Anything failing** while deciding who rings, the lead hears the missed-call
message rather than Twilio's "application error" (`call.incoming_failed`).

### Being rung

The agent's browser must be open and signed in. The app registers with Twilio
as soon as someone signs in (`listenForCalls`, `lib/calling.ts`) and checks
every 30 seconds that it still is (`keepRegistered`) - a laptop that slept, a
token not refreshed, a device thrown away after a failed call all end the
registration without anyone being told. The check never touches a device
carrying a call: the next check once the call is over registers it again.
Signing out destroys the device. If calling's settings
(`GET /api/calls/config`) cannot be read when the page opens - the API
restarting - they are asked again every 15 seconds (`CONFIG_RETRY_MS`,
`lib/incoming-call.ts`) until they answer, and the "Taking calls" switch asks
again the same way (`layout/TakingCalls.tsx`). A closed laptop is a missed call.
There is no ringing of a mobile phone.

Each check also tells the server whether this browser can take a call now -
`POST /api/calls/ringable`, held two minutes (`users.ringable_until`). That is
for the automated call's transfer and for step 3 above; the lead's own agent,
and the last agent who called them, are rung either way. What counts as free,
and busy: `AUTO-CALL-TRANSFER.md`, "Who is free".

### A missed call

The lead hears: "Thank you for calling eDrugstore. Our team member is not
available right now, and will call you back shortly. Goodbye."
(`MISSED_CALL_SPEECH`, `core/calls.ts`). Then:

| | |
|---|---|
| **The call is saved** | `calls` row with `direction = 'inbound'`, `outcome = 'missed'`, whatever Twilio called it (no-answer, busy, canceled). `agent_id` is the agent it rang, or null when it rang nobody or everyone free |
| **The lead is texted** | `message_missed_call` from `settings` (`sendMissedCallText`, `db/lead-texts.ts`), sent through EZ Texting like every other text and saved in `messages`: "eDrugstore: Sorry we missed your call. A team member will call you back shortly." Once per call. Not sent to a blocked number - the do-not-call check is inside the sender |
| **The lead goes to the queue** | Tagged **Missed call**, in bold - unless an agent holds the lead, when the queue still says Working – name and the lead's page and the callback carry it. A closed lead is reopened by it; a lead with no score is in the queue for it too, at the bottom. `QUEUE.md`, "The tag" |
| **The agent gets a callback** | One for the agent it rang, `callbacks.reason = 'missed_call'`, due at once (`finishCall`, `db/calls.ts`) - how My Callbacks shows it: `CALLBACKS.md`, "A missed call's callback". The queue tag says a lead needs calling; this says whose job it is. One per lead however many times they ring. Not booked when the call rang nobody, or everyone free - the lead waits in the queue for anyone - for a deactivated agent, or for a number on the do-not-call list. An agent who pressed Decline gets it too: the lead was still told we would call back |
| **The agent is told** | The card on their screen becomes a notice: "Missed call · Leo M. · Rang for 20s", with **Call back** ("On the screen") |
| **The lead's page says so** | A **Missed call** badge beside the lead's other states, in the queue's words, and a line on the timeline: "Missed call · told we will call back" (`TIMELINE.md`) |

**It stops being a missed call when someone gets back to them.** Any of:

| What | Detail |
|---|---|
| An agent calls the lead | From the moment the call is placed, answered or not |
| An agent texts the lead | Their own text. One EZ Texting refused does not count - it never arrived. Nor does the automated "we will call you back" text: that is the promise, not the call back |
| The lead rings again and is answered | |
| A call with them is under way | No outcome yet, started within the last 2 hours (`CALL_UNDER_WAY_HOURS`) - so an agent talking to the lead is not shown Missed call, and a row Twilio never closed cannot hide one for good. If an incoming call under way ends unanswered, that is a new missed call |
| An automated call - only once a person is on it | The server's scripted call is not a person getting back to them: answered by the lead or under way, it settles nothing until someone takes its transfer. Then it counts like any call with a person on it |
| An agent saves an outcome | Closed or DNC, after the call. They have decided what happens to the lead |

Until then the tag and the badge stay. Reading the lead's page does not clear
it - they asked for a person, and looking is not answering.

The first three also finish the missed call's callback, whichever agent did it
(`finishMissedCallCallbacks`, `db/callbacks.ts`) - nobody ticks it off by hand
- and an outcome finishes it as it finishes every open callback. One an agent
booked themselves is never finished for them. It is finished when the call
back is *placed*, not when it is answered.

`MISSED_CALL_SQL` in `db/lead-state.ts` is the one definition, sharing
`nobodyGotBackSince` with the robot's missed "yes". The queue and the lead card
read it directly; Admin > Leads reads it through Closed - a missed call
un-closes a lead - and has no missed-call status of its own
(`ADMIN-LEADS.md`).

**What a missed call does to the lead's other states.** Its callback counts as
a callback like any other, so the lead reads Working on Admin > Leads; a
missed call that booked none (it rang nobody, or everyone free) does not make
it Working. On Admin > Overview neither the system's callback nor a call that
only rang the agent is that agent's activity - only what they did is.

**A reply to the text goes to a person.** The text goes to any lead not on the
do-not-call list, whatever their conversation's state, and ringing us stops
the text questions - `STATE-MACHINE.md`, rule 2d - so a reply is stored and
flagged Inbound reply, never read as an answer.

**Recorded twice over, on purpose.** How a ring to one agent ended is reported
by Twilio on the agent's leg (`/status`) and again when it asks what to say to
the lead (`/incoming/after`) - asked even when the lead hung up while it rang.
An agent with no browser open may have no leg to report on. Whichever arrives
first records the missed call and sends the text; the other finds it done and
does nothing. A ring to everyone free has only the second. If neither arrives,
the call is ended from Twilio's own record 15 minutes on (`TWILIO.md`, "Calls
whose end never came"), with its callback but no text.

### On the screen

`layout/IncomingCall.tsx`, mounted once in the app shell
(`layout/AppShell.tsx`), so it appears on whichever page the agent is on. It is
also what makes the browser ringable: it starts listening when someone is
signed in and stops when they are not.

**A card in the top right corner, which says who it is before the agent picks
up:**

```
● INCOMING CALL                         0:09
[LM] Leo M.                           [WARM]
     (555) 010-0014
📞 Calling back · you tried 2× today
Score       Next step      Flow
45 / 100    Order online   Completed
[ Decline ]                     [ Accept ]
Accepting opens Leo's workspace and assigns the lead to you.
```

| On the card | From |
|---|---|
| Name, number | Sent with the call (`leadId`, `leadName`, `leadPhone` parameters), so they show the instant it rings |
| How long it has rung | Counted in the browser |
| Tier, score, the lead's last answer (under that question's heading), how far the questions got | The lead card, `GET /api/leads/:id`, fetched as it starts to ring - the same words as the lead's page |
| "Calling back · you tried 2× today" | The lead's timeline: calls agents placed today, by this agent - matched by id - or, named, by another; otherwise when one last called. The server's automated call is not among them - "you tried" is about people. With no agent's call, the automated call is what they are returning - its voicemail asks them to: "Calling back · automated call, 28m ago". Nothing when we never called them. A transfer shows "Transfer · said yes to the offer" instead. `callerContext`, `lib/caller-context.ts` |
| The last line | Drops "and assigns the lead to you" when the agent already holds it |

The card is up at once and the details fill in a moment later; if they cannot
be loaded it still rings and can still be accepted. The tab's title reads
"Incoming call" while it rings.

- **Accept:** the call connects, the lead is picked up for the agent if it is
  not already theirs, and its page opens. From here it is an ordinary call:
  the call bar at the foot of the screen - clock, Mute, Keypad, End - and then
  the note box (`TWILIO.md`, "The screen").
- **Decline:** the lead gets the missed-call message and text. The card goes
  away rather than saying "missed" - the agent chose it - but the lead is
  tagged Missed call in the queue all the same, once the agent lets go of it.
- **Not picked up:** the card becomes a small notice in the same corner -
  "Missed call · Leo M. · Rang for 20s" - with **Call back** and a close
  button. It stays until one is pressed or another call rings. It does not say
  the lead was texted: a blocked number, or EZ Texting refusing, means they
  were not. Call back picks the lead up, opens its page and dials - once; a
  reload or Back does not ring them again. If another agent picked the lead up
  first, or the number is on the do-not-call list, the page opens and nothing
  is dialled.
- **Focus is not moved to the card.** An agent typing a text must not answer
  a call with the space bar.
- **One call at a time.** While an agent is on a call, a second caller is not
  shown to them and gets the missed-call path - after ringing out its 20
  seconds, since Twilio's SDK ignores a call to a busy browser rather than
  refusing it. The lead's own Call button is off while an incoming call is
  ringing or live.
- **A ring ends however it ends** - Twilio's `cancel`, a dropped connection or
  an error before it was answered - and a ring no event ever ends is cleared
  after 90 seconds (`RING_SAFETY_MS`), longer than any ring we place.

### A ring that goes to several people

The automated call's transfer, a lead on hold rung to the person who came
free, and a lead calling back whom nobody owns all ring with markers: the
server adds `<Parameter>`s to each `<Client>`, beside `leadId`, `leadName` and
`leadPhone`:

| Parameter | Means |
|---|---|
| `ring=group` | The ring goes on without this person if they do not take it: several people rung at once, the first to accept taking it - or the lead's own agent rung alone first, the others next - or a lead waiting on hold rung to one person who came free - or a lead calling back whom nobody owns, everyone free rung |
| `reason=transfer` | A lead who said yes on the automated call, being put through |
| `step` | With a transfer: the heading of the question they said yes to - "Offer" |

`ringKind` (`lib/calling.ts`) reads them; nothing attached is a ring to one
person. On the screen:

- **Over without this person answering, it clears quietly** - no "Missed
  call" notice. The browser cannot tell whether someone else took it or it
  went on to the hold or busy line, and either way it was never this person's
  missed call.
- **Arriving while anything keeps them busy** - a call, a ring, a note box
  open after a call, on any page (`lib/presence.ts`) - it is declined at once
  and never shown, so a note being written is never lost to it. Twilio keeps
  ringing the others: one browser declining is busy for that one only, and
  the whole ring is busy only when every browser was ("Busy Everywhere",
  error 31600).
- **Decline** declines it for this person; the others keep ringing.
- **A transfer says so** in place of "Calling back": "Transfer · said yes to
  the offer", from `step` (`transferContext`, `lib/caller-context.ts`).
- A ring to one person is unchanged - including that it takes the place of an
  open note box, since it is that agent's own lead calling.

### The ringtone

`lib/ringtone.ts` plays the app's own ringtone - a short melody of eight soft,
mallet-like notes rising and falling, a pause, and again - for as long as the
card is up. The tune is our own and is made in the browser; there is no sound
file. Twilio's built-in ringtone is switched off (`device.audio.incoming(false)`,
`lib/calling.ts`): a call the agent cannot hear is a missed call, and this one
we control.

**How it is played, and why - Safari.** The melody is computed once into a WAV
in memory and looped by an ordinary `<audio>` element - what every browser
plays the same way; the Web Audio API rang in Chrome and was silent in Safari.
The first click anywhere - the sign-in button counts; `main.tsx` arms it for
the whole app (`armRingtone`) - plays it muted and at zero volume for an
instant, which is what lets it play aloud later with nobody clicking. Muted
alone is not enough: Safari let the first notes through.

#### Safari starts it again by itself

A few seconds after a ring ends and the tune is paused, Safari can start the
same element playing again, with no `play()` from our code or Twilio's - and
it would loop on, with no card on screen, until the page was reloaded. So the
element watches itself: playing while nothing is ringing, and not the silent
first play, it is paused at once, whatever started it (`hush`). Stopping only
pauses; a ring starts it from the top.

**A browser will not play sound on a page nobody has clicked on.** Signing in
counts as a click; a reload does not. So after a reload the corner shows "Call
sound off · click to turn on" (`canRing`) until the agent clicks or presses a
key, and then it goes. A call arriving before that click still shows its card,
silently.

### The desktop notification

`lib/call-notification.ts`: "Incoming call · Leo M.", shown by the operating
system with its own sound. It reaches an agent whose browser is behind another
window or minimised, and one whose page cannot ring yet. The browser asks the
agent's permission once, on their first click after signing in
(`askToNotify`); refused, the card and the ring still work. One at a time: a
second ring replaces the first. It closes when the ring ends, and clicking it
brings the app to the front.

## Rules

1. **The lead's own agent is rung alone** - the holder, else the last agent
   who called them, active accounts only - switch or not, free or not. A ring
   they miss is a missed call, never passed on.
2. **With automated calls on, a lead with no agent of its own rings everyone
   free**, at most ten; the first to accept takes the call and the lead, once.
   Off, it is a missed call.
3. **A deactivated agent is never rung**, and cannot take a call.
4. **A number we hold no lead for rings nobody**, is not texted, and leaves no
   `calls` row - its record is the activity log.
5. **A missed call is texted once**, never to a blocked number, and books one
   callback for the agent it rang - none when it rang nobody or everyone free.
6. **Twilio asking again keeps the first decision.**
7. **A missed call stays until someone gets back to them** (`MISSED_CALL_SQL`);
   reading the lead is not answering.
8. **One call at a time per browser**, and a busy browser never shows a ring
   that goes to several people.
9. **Focus never moves to the card.**

## Data

It writes `calls` (`direction = 'inbound'`; `outcome = 'missed'` for a call
nobody answered; `agent_id` the agent it rang - null when it rang nobody, and
while a ring to everyone rings, until one of them takes it; `twilio_call_sid`
the lead's leg; `ended_at` when the agent's leg ended, at once for a call that
rang nobody, or when the whole ring's end was reported for a ring to
everyone), `callbacks`
(`reason = 'missed_call'`) and `messages` (the text); it reads `leads`,
`users` (who is active, who is free) and `dnc_list`. Columns: `SCHEMA.md`.
Every request is kept in `webhook_events`; `call.incoming`, `call.missed`,
`call.ended`, `call.taken`, `callback.booked` and `callback.done` go to the
activity log - `AUDIT.md`. Log events, `call.incoming`, `call.ring_not_taken`,
`call.take_refused` and the rest: `LOGGING.md`.

## Code

| File | What it does |
|---|---|
| `backend/src/db/calls.ts` | `startIncomingCall` - who rings, and the row; `finishCall` - a missed call and its callback; `takeIncomingCall`, `incomingTakenBy` - a ring to everyone taken |
| `backend/src/db/claims.ts` | `takeCallWithLead` - the lead follows the call |
| `backend/src/db/presence.ts` | `freePeople`, `FREE_SQL` - who is free (`AUTO-CALL-TRANSFER.md`) |
| `backend/src/db/lead-texts.ts` | `sendMissedCallText` |
| `backend/src/db/callbacks.ts` | `finishMissedCallCallbacks` |
| `backend/src/db/lead-state.ts` | `MISSED_CALL_SQL` |
| `backend/src/core/calls.ts` | `INCOMING_RING_SECONDS`, `MISSED_CALL_SPEECH` |
| `backend/src/integrations/twilio.ts` | `ringAgentTwiml`, `ringEveryoneTwiml`, `missedCallTwiml`; `INCOMING_PATH`, `INCOMING_AFTER_PATH`, `INCOMING_CLAIM_PATH` |
| `backend/src/api/twilio-webhooks.ts` | `/incoming`, `/incoming/after`, `/incoming/claim` |
| `frontend/src/layout/IncomingCall.tsx`, `frontend/src/styles/incoming-call.css` | The card, the missed-call notice, "Call sound off", the tab title; mounted once in the app shell |
| `frontend/src/lib/incoming-state.ts` | A lead calling in - none, ringing, call, missed - one call at a time, and each ring's `RingKind` (alone or shared, a transfer or not), pure |
| `frontend/src/lib/incoming-call.ts` | The store (zustand) joining those states to Twilio: a store, not page state, because a call arrives on any screen and the lead's Call button must know one is under way. It declines a shared ring while the browser is busy |
| `frontend/src/lib/calling.ts` | `listenForCalls`, `keepRegistered`; `ringKind` and `incomingLead` - how and for whom it rings, from the call's parameters; `RING_SAFETY_MS` |
| `frontend/src/pages/workspace/CallBar.tsx` | Once accepted, the same call bar as a call we place - which is why it takes `who: { leadId, name, phone }` rather than a lead. The incoming call's bar lives in the shell, so it survives moving between pages (`TWILIO.md`, "The screen") |
| `frontend/src/lib/caller-context.ts` | `callerContext`, `transferContext` - the card's "Calling back" line, pure |
| `frontend/src/lib/ringtone.ts` | The ringtone: `armRingtone`, `startRinging`, `canRing` |
| `frontend/src/lib/call-notification.ts` | The desktop notification |
| `frontend/src/main.tsx` | Arms the ringtone on the first click |
| `frontend/src/pages/WorkspacePage.tsx` | Call back from the notice: the router state `callBack` - cleared before it dials, so a reload or Back does not ring the lead again; nothing dialled if someone else holds the lead or the number is blocked |
| `frontend/src/pages/CallbacksPage.tsx` | The missed call's callback row on My Callbacks (`CALLBACKS.md`) |

## Tests

| What | Where |
|---|---|
| Who an incoming call rings, a missed call, its effect on the queue and Admin > Leads, what settles it and what does not, its callback - booked once, finished by a call or an answer; everyone free for a lead nobody owns, taken once, refused, Twilio asking again | `backend/scripts/calls-live-check.ts` - against a real Postgres |
| A text back finishes the missed call's callback, and not one the agent booked | `backend/scripts/agent-sms-live-check.ts` |
| The routes: who is rung and how it is marked, the missed-call text sent once, taking a ring to everyone, refusals, the whole ring's end | `backend/src/api/__tests__/calls.test.ts` |
| The TwiML of a ring to one and to everyone | `backend/src/integrations/twilio.test.ts` |
| Being rung through the SDK, against a stand-in for it: accept, decline, sign-out. Added after Accept failed on the first real incoming call - the function joining a call's events to the screen called itself, and no test ran it | `frontend/src/lib/calling.device.test.ts` |
| Ringing, answered, missed, declined, one call at a time; what the card shows; Call back; busy until the note box closes; a ring several people got - cleared quietly, declined while busy with the note kept as typed - and a transfer's card | `frontend/src/lib/incoming-state.test.ts`, `frontend/src/layout/IncomingCall.test.tsx` |
| The "Calling back" line and a transfer's line | `frontend/src/lib/caller-context.test.ts` |
| The ring: starts, repeats, stops, stays silent while the browser blocks sound; the desktop notification | `frontend/src/lib/ringtone.test.ts`, `frontend/src/lib/call-notification.test.ts` |

## Not done

- **Voicemail.** A missed caller hears the message and the call ends. Nothing
  is recorded.
- **A call queue.** One agent is rung; or, with automated calls on, everyone
  free at once for a lead nobody holds or has called; or nobody. The
  automated call's hold line is only for its own transfers
  (`AUTO-CALL-TRANSFER.md`, "The hold line").
- **Nobody is rung for a lead no agent has touched, with automated calls off.**
  It becomes a missed call and waits in the queue.
- **A second device.** An agent signed in on two browsers rings on both; the
  first to answer takes it.
- **A mobile phone.** Only a browser rings.
- **A blocked number that rings.** No text, no callback, and it is not in the
  queue - but the lead's page still shows the Missed call badge.
- **The lead's place in the queue.** A lead with no score who rings is in the
  queue, at the bottom; past 100 rows it would be cut off (`QUEUE.md`).
- **The "Unknown caller" card.** The design shows a card for a number that is
  not in our leads, with "You can create one after the call". It is not built:
  a caller we hold no lead for rings nobody - there is no agent whose call it
  is - and the app cannot create a lead by hand; leads come from EZ Texting.

## Decisions

| Decision | By | Date |
|---|---|---|
| Incoming calls, the simple version: ring the lead's agent; if nobody picks up, a message, a text that we will call back, and the call shown as missed. No call queue | Jeel | 2026-10-01 |
| A missed call books a callback for the agent it rang | Jeel | 2026-10-01 |
| A missed call is a badge on the lead's page, like Closed and Needs review - not a banner | Jeel | 2026-10-01 |
| The incoming call is a card in the top right corner that says who it is before the agent picks up | Jeel | 2026-10-01 |
| The ringtone is our own melody, not a phone line's ring | Jeel | 2026-10-01 |
| No "Unknown caller" card: a number we hold no lead for rings nobody, and no lead is made by hand | Jeel | 2026-10-01 |
| The card's line for a lead returning the robot's call: "Calling back · automated call, 28m ago" | Jeel | 2026-10-24 |

## History

- 2026-11-27 · Written from `TWILIO.md`'s "Incoming calls" and `FRONTEND.md`'s incoming-call table, to the area template; the lead says a lead nobody owns rings everyone free; a ring neither of Twilio's reports reaches is closed from Twilio's record, not left open · the docs standard · D38
- 2026-11-23 · A last caller counts only while active: the latest call by someone still active rings them, even when someone since deactivated called after · review R10
- 2026-11-22 · A ring to everyone free that Twilio called `completed` but nobody took - its only accept refused - is a missed call, texted (`call.ring_not_taken`); before, it counted as taken · review H9
- 2026-11-22 · The registration check leaves a device carrying a call alone · a registration lapsing mid-call (a token not renewed) had the check destroy the device, and the live call with it · review H7
- 2026-11-22 · A ring ends on a dropped connection or an error too, and after 90 s at most · before, the card stayed ringing, the ringtone looping and the browser busy, until Decline · review M29
- 2026-11-22 · Calling's settings asked again every 15 s until they answer · a page opened while the API restarted was never ringable until a reload · review M28
- 2026-11-22 · "You tried" matched by the agent's id · by name, two agents sharing one both read "you" · review M32
- 2026-11-22 · A call whose end never came is closed from Twilio's record (`TWILIO.md`). Before, a ring neither report reached kept `ended_at` null and read "Incoming call · ringing" for good - not seen in testing · review H4
- 2026-10-27 · A reply to the missed-call text goes to a person for a lead still answering the questions too - ringing us stops them (`STATE-MACHINE.md`, rule 2d). Before, it was read as an answer - "ok thanks" got the current question's "sorry" - which the robot's calls made common: its leads are still on Q1 · W2
- 2026-10-24 · With automated calls on, a lead nobody holds or has called rings everyone free; `/incoming/claim`; the end taken from the whole ring; Twilio asking again keeps the first decision. Call 63: the dev number called, both windows rang, one accepted and took the call and the lead - its browser's pick-up arrived 2.4 s before the claim. Call 64: after release, the next call back rang everyone free again · a lead returning the robot's voicemail had nobody to ring · T19
- 2026-10-20 · The ringtone pauses itself if it plays with nothing ringing (`hush`) · Safari restarted it a few seconds after a ring, every time, in Safari only - watched in Safari's console; the fix was seen catching it seven seconds after a ring
- 2026-10-20 · The first real ring to several people: one browser declined, the other kept ringing and took it · T15a
- 2026-10-18 · A ring that goes to several people (`ring=group`, `reason=transfer`, `step`), declined by a busy browser · T11. The browser tells the server whether it can take a call (`POST /api/calls/ringable`) · T9. "You tried" leaves out the robot's call · T5
- 2026-10-17 · `/incoming/after` asked even when the lead hung up while it rang
- 2026-10-05 · The lead hears "Thank you for calling eDrugstore" - "Secure Medical" before; the missed-call text reworded for eDrugstore by migration 012 (007 seeded the first, signed Secure Medical)
- 2026-10-01 · The ringtone: a melody made in the browser, looped by an `<audio>` element, played muted and at zero volume on the first click · the first version played a phone line's two-tone ring, which to the agent sounded like they were calling someone; Twilio's own ringtone did not sound on the first real calls; the Web Audio API was silent in Safari, created before the first click or inside it (two attempts); Safari let the first notes through with muted alone. Checked in Chrome - it decodes, rings, loops and stops - and confirmed by ear in Safari by Jeel · Jeel
- 2026-10-01 · The card in the top right · replacing the first version's bar at the foot of the screen, which showed only a name and a number · Jeel
- 2026-10-01 · Missed call as a badge on the lead's page · it was a sentence in a yellow banner for a day · Jeel
- 2026-10-01 · An outcome settles a missed call · found in the doc review: a lead closed without a call back stayed in the queue as Missed call
- 2026-10-01 · A call under way settles a missed call · found on the first real answered call: the agent was talking to the lead under "Missed call"
- 2026-10-01 · Incoming calls built: ring one agent, the missed-call message and text, the queue tag, and a callback for the agent it rang; the browser's token gained the incoming grant, so it can be rung · migrations 007, 008 · Jeel
