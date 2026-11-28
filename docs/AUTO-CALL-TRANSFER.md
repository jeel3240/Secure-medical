# Who takes the robot's "yes"

Who is free to take a call, the "Taking calls" switch, how a "yes" on the robot's
call is put through to a person, the hold line when nobody can take it yet, the ring
to the next person who comes free, and a lead calling back. Part of the robot's call
- [`AUTO-CALLS.md`](AUTO-CALLS.md) is who is called and how a call is placed;
[`AUTO-CALL-SCRIPT.md`](AUTO-CALL-SCRIPT.md) what the call says. Who is free is
`backend/src/db/presence.ts` with `frontend/src/lib/presence.ts`; the switch is
`backend/src/api/taking-calls.ts` and `frontend/src/layout/TakingCalls.tsx`; the
transfer and the hold line are pure rules in `backend/src/core/call-script.ts`,
carried out by `/auto/gather`, `/auto/claim`, `/auto/after`, `/auto/hold` and
`/auto/offer` in `backend/src/api/twilio-webhooks.ts`, with the hold watcher in
`backend/src/api/hold-watch.ts`.

## How it works

### Who is free

**Free** means: the "Taking calls" switch is on, the app is open (the browser tells
the server every 30 seconds; silent for 2 minutes is gone), and not on a call or with
an after-call note open.

**Free, in one place** - `FREE_SQL` in `db/presence.ts`: an active account, the
switch on, the browser able to ring (`RINGABLE_SQL`), and no call of theirs still
going (`ON_A_CALL_SQL`) - checked on the server too, so a call counts the moment it
starts, not at the browser's next word. "Still going" is a call of theirs with no
outcome, started in the last 2 hours (`CALL_UNDER_WAY_HOURS`, the window a missed
call's "under way" uses): a ring for an incoming call to one agent counts, while a
call back ringing everyone free and an automated call nobody has taken keep nobody
busy until someone takes them - the people rung are kept out by their own browsers
saying busy. A call whose end Twilio never reported stops counting after those 2
hours, and is ended from Twilio's own record 15 minutes on (`api/left-open.ts`,
`closeFromTwilio` - `TWILIO.md`, "Calls whose end never came"). Nor is anyone free
whom a lead on hold is ringing now (a live `call_offers` row): a transfer could
otherwise ring them in the seconds before their browser said busy, the browser would
decline one of the two, and a declined offer shuts them out of that held lead. A
small index of the calls still going (`calls_under_way_by_agent`, migration 017)
keeps it instant.

`freePeople` lists them, lowest ids first. A transfer rings them, at most ten ("The
transfer"); a lead on hold rings one of them ("The next person who comes free gets
the waiting lead"); a lead calling back whom nobody owns rings them, at most ten ("A
lead calling back"); and the robot counts them for how many calls it places
(`AUTO-CALLS.md`, "Traffic"). A deactivated account is never free, whatever its
switch says.

### The "Taking calls" switch

A switch in the app bar, next to the user menu, for everyone - agent or superadmin.
**The switch decides who is rung, not the role**: a superadmin who works leads
switches it on; one who does not leaves it off and is never rung for a transfer.

- Off at every sign-in; the person turns it on. Signing out turns it off. Signing in
  turns it off even if another browser left it on: the person chooses again, and
  that other browser shows "off" within half a minute.
- **Letting a transfer ring out turns it off**, with a short notice: "Missed a
  transfer · Taking calls off" - below.
- Every change is recorded in the activity log.

`users.taking_calls`, off for everyone to begin with (migration 017);
`POST /api/calls/taking-calls`; `layout/TakingCalls.tsx` in the app bar, beside the
user menu - a small switch that turns green when on. Each change is a
`calls.availability_changed` row, with `on` and `why`: `by_hand`, `sign_in` or
`sign_out` (`api/taking-calls.ts`), and only when it really changed - signing in with
it already off records nothing.

- **Shown, and accepted, only while automated calls are on** - `AUTO_CALLS`
  (`ENVIRONMENT.md`) and calling set up (`api/index.ts`). Off, the route refuses
  (`auto_calls_off`) and the app bar has no switch. `GET /api/calls/config` tells the
  browser (`autoCalls`).
- **It flips once the server has it.** A switch that showed "on" before it was saved
  could leave someone believing they will be rung when they will not. A failure
  leaves it where it was, and says so on hover.
- **Every browser learns the switch** from the answer to its 30-second report
  ("The app is open").

### Letting a transfer ring out turns it off

A desk left with the switch on stops being rung after one missed transfer: one lead
is affected, not every lead until they return. It only happens to someone who was
free when rung; someone on a call is never rung, so a call never turns it off.

It is decided when the ringing is over (`/auto/after`, `rangOut` in
`core/call-script.ts`), never from one person's ring on its own: Twilio reports a
ring cut short by someone else answering exactly as one that ran its course -
`no-answer`, SIP 487, both.

- **Someone took it, or the lead hung up while it rang**: nobody's switch changes -
  the ring was not left to run out.
- **It ran out**: the lead's own agent rung alone is switched off. With several rung,
  Twilio is asked how each person's ring ended - the transfer's rings are the
  automated call's child calls (`transferRings` in `integrations/twilio-calls.ts`) -
  and only those whose own ring ran out (`no-answer`) are switched off, never who
  declined (`busy`) - and for someone rung more than once on one call, their latest
  ring. Not answered by Twilio: nobody (`auto_call.rings_unread`).
- **Only if still on, the account active, and not on a call by now**
  (`switchOffAfterMissedRing` in `db/presence.ts`) - someone who started a call of
  their own while it rang keeps it on. The browser's word is not asked: the ring
  itself made it busy.
- **One statement with its record**: `calls.availability_changed`, `on: false`,
  `why: missed_transfer` and the `callId` - the system's doing, so no actor; the
  person is its subject.
- **Why it is so is kept with it**: `users.taking_calls_why` - `by_hand`, `sign_in`,
  `sign_out` or `missed_transfer` - written on every write of the switch. Sign-in
  always writes `sign_in`, so yesterday's missed transfer is never shown today.
- **The screen learns it from the browser's 30-second report**:
  `POST /api/calls/ringable` answers with the switch and why (`setRingable`); the
  browser takes it into the signed-in user's `takingCalls` and `takingCallsWhy`
  (`lib/taking-calls.ts`), unless a switch made in that browser crossed that report -
  the switch's own answer is newer. The app bar then shows "Missed a transfer ·
  Taking calls off" beside the switch, in the app's warning colour, until it is
  switched on again - also after a reload. It shows within about ten seconds.
- A deactivated account is never free; signing in again after reactivation turns it
  off. A call back's ring let run out turns no switch off - only a transfer does.

### The app is open

`db/presence.ts` on the server, `lib/presence.ts` and `lib/calling.ts` in the
browser. Each signed-in browser where calling is set up tells the server, every 30
seconds and at once when it changes, whether it can take a call now: registered with
Twilio, and nothing on its screen keeping the person busy - a call being placed or
live, a lead ringing, or a finished call's note box still open (`occupiesAgent`,
`incomingOccupiesAgent`). The server keeps the word for two minutes
(`users.ringable_until`, `RINGABLE_SECONDS`), so a browser that closes, loses its
connection or sleeps stops counting by itself.

- **"Not available" is said, not left out**: the moment a call or a ring starts, and
  while Twilio cannot be reached. The server knows at once, or within half a minute,
  rather than in two minutes.
- The reports go one after another, each reading the screen as it is sent, so an
  older "available" can never land after a newer "busy".
- **Ending a session clears it at once**: signing out, being deactivated, a password
  change (`db/users.ts`, where every session ends). A deactivated account can never
  be made ringable.
- Leaving the app's pages without signing out - the Change password page - stops the
  browser ringing at once, and lapses on the server within two minutes, as a closed
  tab does.
- Not in the activity log: it is the present moment, overwritten every half minute
  (`AUDIT.md`).
- **Two tabs** of one person each speak for themselves, and the last word wins: a
  note box open in one tab while the other says "available" is not seen. "Not on a
  call", checked on the server, covers a call under way in either.

**In the browser.** Busy is `lib/presence.ts`, a small register that knows nothing
about calls: the lead's call (`useLeadCall`, by `useBusyWhile`) and the incoming call
(`lib/incoming-call.ts`, by a store subscription) each mark it under their own name,
and clear it when they end - or when the page goes. What counts as busy is pure:
`occupiesAgent` in `lib/call-state.ts` - placed, live, or ended with the note box
open; a failure is only a message - and `incomingOccupiesAgent` in
`lib/incoming-state.ts` - ringing too; a missed call is only a notice. The report
(`lib/calling.ts`, `POST /api/calls/ringable`) goes with each 30-second registration
check and at once on a change of busy, each with a ten-second limit (`postRingable`,
`api/calls.ts`), so one stuck request cannot hold back the rest. Nothing is said when
listening stops: the sign-out has already cleared it on the server.

**The switch in the app bar** (`layout/TakingCalls.tsx`, before the user menu) is a
small `role="switch"`, muted when off and the green of a live call when on
(`--color-call-live`, `styles/shell.css`). It is shown only when
`GET /api/calls/config` says calling is set up and `autoCalls` is on - unknown is
hidden - and that is asked again every 15 seconds until it answers
(`CONFIG_RETRY_MS`). Its state is the signed-in user's `takingCalls`, from the
sign-in store, so it needs no fetch of its own and a reload shows what the server
holds. A click saves first and flips after, disabled meanwhile. The "Missed a
transfer · Taking calls off" notice is amber on the navy bar
(`.taking-calls__notice`, `role="status"`).

### The transfer

A "yes" to a step whose choice ends in `transfer` (Q1) is put through to a person, in
`/auto/gather`; the rules are pure, `planTransfer` and `planAfterHolder` in
`core/call-script.ts`. Seri's transfer, from `/auto/ai-after`, goes through the same
code (`planYes`, `yesTwiml`), its ring shown as a yes to the script's first step
(`AI-AGENT.md`).

1. **Who can take it is read at that moment**: everyone free (`freePeople`) and who
   holds the lead (`transferContext`). A machine's verdict that is acted on hands the
   call to the voicemail message, and nothing after it is taken as an answer; one the
   call ignores is a person's, whose yes rings (`AUTO-CALL-SCRIPT.md`, "Voicemail").
   - **The lead's own agent is free**: the choice's reply ("Great, connecting you with
     a live agent now. Please hold."), the recording notice, then they ring
     **alone** for `auto_call_ring_seconds`. Not free - on a call, away, or the
     switch off - they are not waited for: everyone free rings at once, below.
   - **Nobody free**: the choice's reply, then on hold while someone is on a call or
     writing its note ("The hold line"); otherwise the busy line - `transfer_missed`,
     saved with the answer.
   - **Otherwise**: the choice's reply, the recording notice, then everyone free rung
     together (`transferTwiml`) - at most 10, Twilio's limit in one `<Dial>`
     (`MAX_RUNG_AT_ONCE`) - for `auto_call_ring_seconds` (25; read on every transfer
     by `readRingSeconds`, and 25 when it is missing or not 5-60).

   Each ring carries the lead and marks itself a transfer - `ring=group`,
   `reason=transfer`, and the step said yes to - so the browsers show it as one
   (`INCOMING-CALLS.md`, "A ring that goes to several people"). The lead's own agent,
   rung alone, gets `ring=group` too: the ring goes on without them if they do not
   take it, so their browser treats it as any shared ring - it clears with no "Missed
   call", and is declined while they are busy. No report per person: the end is the
   call's own.
2. **The first to accept is connected**; Twilio stops ringing the rest. Before
   connecting them it runs `/auto/claim` on their leg: who they are is `To`, our own
   signed browser name; the call is `ParentCallSid`, matched to the row
   (`linkAutomatedCall`). `takeTransfer` (`db/auto-calls.ts`), built on
   `takeCallWithLead` (`db/claims.ts`) - one transaction with both rows locked, shared
   with a call back that rang everyone free:
   - the call becomes theirs and `transferred` - from then on it counts as a person's
     work: Working, a missed call returned;
   - **the lead becomes theirs, taken from anyone who held it** - a lead who said yes
     goes to whoever answered. `lead.picked_up` records it with `via: transfer`, the
     call, and `tookOverFrom`;
   - `call.transferred` records taking the transfer, once per call, whoever held the
     lead - written whichever arrives first, Twilio's `/auto/claim` or the browser's
     own pick-up of the lead as it accepts (`lib/incoming-call.ts`, `claimLead`).

   Refused - another person has the call, the account was deactivated while it rang,
   no such call, or the call over or taken by the voicemail message (an accept that
   waited on the call's lock while `actOnVerdict` replaced it; the other order, the
   accept first, is `onVerdict`'s, which carries on) - their leg is hung up before it
   is connected. A database error after they accepted still connects them: the lead
   is waiting for a person, and the error is logged (`auto_call.claim_failed`).
3. **When the ringing is over**, Twilio asks `/auto/after` with how it went
   (`DialCallStatus`). `completed` is taken only when the call is someone's
   (`transferTakenBy`): Twilio says `completed` once an accept was answered, even
   when `/auto/claim` refused it and hung that leg up, and such a ring ends as one
   nobody took (`auto_call.ring_not_taken`). The address names the step and, after a
   ring to the lead's own agent, who they were. Taken - they talked, nothing more to
   say. The lead's own agent let it ring out, or declined: **everyone else free rings
   at once** (`planAfterHolder`) - not them, with nothing said, since the lead has
   been listening to it ring and has heard the notice. Nobody else free, or nobody
   accepted: on hold while someone is on a call or writing its note ("The hold
   line"); otherwise `missTransfer` - `transfer_missed`, unless the call already has
   a result - and the busy line. The lead hung up while it rang
   (`CallStatus=completed`): nobody further is rung, `transfer_missed`. An agent
   calls them back: the queue puts them first, as Wants a call (`QUEUE.md`).
4. **Recorded from the moment a person answers**, both sides apart, as every call is:
   the lead on channel 1, the person on channel 2 - so the transcript says who said
   what (`core/transcripts.ts`).

Whoever let it ring out has their switch turned off once the ringing is over
("Letting a transfer ring out turns it off").

**What Twilio and the browsers do**, as real transfers showed:

- One browser declining leaves the others ringing. The Decline button and a busy
  browser's automatic decline are the same request to Twilio (`call.reject()`).
  Reloading the window that is ringing declines it too - Twilio reports `busy` - and
  the transfer goes on to the others.
- Accepting with no microphone turns the ring down: Accept shows an error and Twilio
  counts the ring `busy`, so the transfer goes on and that person's switch stays on.
  A microphone plugged in afterwards is seen after a reload.
- A finished transfer leaves its note box open, as every call does, and the browser
  counts as busy - not rung for the next transfer - until the note is saved or
  skipped.
- When nobody takes it, the busy line comes about 44 seconds after the lead's "yes":
  about 19 for the reply and the recording notice, then the 25 of ringing.

### The hold line

A "yes" nobody can take now - nobody free to ring, or nobody took the ring - waits on
hold while someone who takes transfers is on a call, or has just finished one and is
writing its note, and so will be free soon; otherwise the busy line at once. The
rules are pure, in `core/call-script.ts`: `planNobodyTook`, `holdGoesOn`,
`placeLine`, `pickOffer`.

1. **On hold** (`/auto/gather` or `/auto/after`): the yes's own reply ("Great,
   connecting you with a live agent now. Please hold.") when it came with the yes,
   then the script's `hold_body` - "All our agents are on other calls. Please stay on
   the line." - and on to `/auto/hold`. A yes put on hold before any ring also hears
   the recording notice here: whoever takes them later is recorded from the moment
   they answer, and the ring from hold says nothing. The call's `held_at` is set, the
   first time only, with its `call.held` record (`holdCall`).
2. **Waiting** (`/auto/hold`): the lead's place in the script's words - "You are
   next." (`hold_next_body`), "You are number 2 in line." (`hold_place_body`); first on
   hold, first in line, among every call waiting (`holdState`) - then a track of hold
   music, then back to `/auto/hold`.
3. **Someone comes free**: the lead who has waited longest rings them alone (below).
4. **Each time** `/auto/hold` is asked: someone is still coming for the lead
   (`someoneComing`, below) and the lead has waited less than
   `auto_call_hold_max_minutes` (10) - the place again and the next track. The hold
   page's address counts the tracks (`track`, `holdTrackIndex`), so each ends into
   the next and none plays twice running; sent back to hold from elsewhere - an offer
   not taken, the watcher - there is no count, and minutes waited choose it.
   Otherwise the busy line, `transfer_missed`, so an agent calls them back (first in
   the queue, `QUEUE.md`).
5. **The hold watcher** (`api/hold-watch.ts`, `checkHolds`), every 30 seconds in the
   api while automated calls are on: offers that never heard back ended, leads
   offered to whoever is free, then a lead nobody is coming for, or past the safety
   stop, sent back to `/auto/hold` at once through Twilio's API, cutting the music
   short (`recheckHold`, `via=watcher`). Who still waits is left alone. A call Twilio
   will not take is asked about: when Twilio's own record says it is over - the lead
   hung up as the api restarted, and its end report never reached us - it is ended
   here as that report would have (`closeFromTwilio`, `api/left-open.ts`: Twilio's
   `callEnd`, then `finishCall` and the script settled; `auto_call.hold_closed`), so
   it never looks on hold for ever.
6. **Hanging up on hold** is `transfer_missed` at the call's end, never `hung_up` -
   they said yes and reached nobody.

**Whether a yes goes on hold at all** is `someoneOnOrJustOffCall` (`db/presence.ts`):
an active account with the switch on, and a call of theirs going - or one that ended
in the last two minutes while their browser has not said it is free since
(`JUST_OFF_A_CALL_SQL`): its note box is open. A lead's call that rang them and they
never answered is not one: otherwise someone away with the switch on would keep
every "yes" waiting on hold for two minutes. Two minutes, as a browser's word holds:
a note box left open longer, or a browser closed on it, stops counting by itself.
Someone free who did not take the ring does not count - they had their chance.
**Another of the robot's calls ringing its transfer counts too**
(`TRANSFER_RINGING_SQL`): with calls going at once, a second "yes" can come while the
first rings everyone free - their browsers say busy and no call is theirs yet, so
they are neither free nor on a call, and the second lead would hear the busy line
though someone will be free in seconds. The call asking leaves itself out. A call
Seri took counts the same once her part ended with `transfer_to_agent`
(`calls.ai_ended_with`): it keeps no script answer.

**The music is Twilio's own classical hold music** - six tracks in a list in
`integrations/twilio.ts` (`HOLD_MUSIC`), more to be added there if wanted. Each runs 5
to 10 minutes, and Twilio asks `/auto/hold` again only when one ends: so the lead
hears their place when a track starts - every 5 to 10 minutes - and the watcher, not
the music, decides how soon they leave. Cutting a track to say the place again would
restart the same piece, so it is not done.

**Someone is on hold** is a call with `held_at`, no result yet, and not ended
(`ON_HOLD_SQL`) - while one is, the robot places no new calls (`AUTO-CALLS.md`,
"Traffic").

### The next person who comes free gets the waiting lead

- **When**: whenever someone's browser says it can take a call - at once when the
  note of their call is saved or skipped, and on each 30-second report
  (`POST /api/calls/ringable`) - or they switch "Taking calls" on (`api/calls.ts`,
  `offerHoldTo`). After the browser has its answer. The watcher also offers on every
  look, to anyone free: a browser whose word was missed, or someone who came free
  another way (their call ended with no note box - a call row the browser never saw).
- **Who**: the lead who has waited longest and is not ringing someone already rings
  the first free person who has never been offered that lead (`pickOffer`,
  `startOffer`), alone, for `auto_call_offer_ring_seconds` (20). One offer at a time
  per lead and per person.
- **How it rings**: an offer is a `call_offers` row (migration 020), written before
  Twilio is asked; then Twilio's API sends the call to `/auto/offer` (`sendToOffer`),
  cutting the music. That rings the one browser as a transfer - `ring=group`,
  `reason=transfer`, the step the lead said yes to - which the browser handles as any
  shared ring (`INCOMING-CALLS.md`, "A ring that goes to several people"). Nothing is
  said first: the music stops and it rings.
- **Taken**: as any transfer - `/auto/claim`, the lead and the call become theirs
  (`takeTransfer`, which also ends the offer `taken`), `transferred`.
- **Not taken**: `/auto/after` (its address names the `offer`) ends it - `declined`,
  `missed` when it rang out, or `failed` when the ring never completed (Twilio's
  `failed` or `canceled`) - and the lead goes back on hold, where `/auto/hold`
  decides again. Rang out: their switch is turned off, as for any transfer;
  declined: it stays on. Either way that person is never offered that lead again.
- **Ended once, never removed**: `taken`, `declined`, `missed`, `failed`, `hung_up`
  (the lead hung up while it rang), `expired` (open its longest ring and 30 seconds
  more - 90 seconds, `OFFER_STALE_SECONDS` - and never heard back: the watcher ends
  it), `unsent` (Twilio would not take the redirect, or the call was not ours to
  ring). The database holds one live offer per lead and per person, so two triggers
  at once - a browser saying it is free and the watcher's look - can never both ring
  (`call_offers_one_live_per_call`, `call_offers_one_live_per_agent`).

**Someone is still coming for a lead** (`someoneComing`, `db/hold-offers.ts`) while
anyone who takes transfers, and has never been offered this lead, is on a call, has
just finished one (the two minutes above), is free, or is ringing with another lead
now - or whoever another call's transfer is ringing. Nobody coming: the busy line at
the watcher's next look, rather than music for nobody. Someone who has had the lead
and not taken it is not coming for it, whatever they are doing.

**Twilio's two requests as the music is cut.** Twilio sends the music page's own
`<Redirect>` to `/auto/hold`, and the API redirect's address too, and follows the API
redirect; the music page's request comes first. So the offer row is written before
Twilio is asked, and `/auto/hold`, asked while an offer is live, answers with the
same ring and changes nothing.

### A lead calling back

The voicemail asks the lead to call back, and a lead the robot reached has no agent
of its own - nobody holds them, and the robot's call has nobody on it. So with
automated calls on, a call from a lead nobody holds or has called rings **everyone
free** together (`FREE_SQL`, at most ten). A lead with an agent of its own - who
holds them, or last called them (a robot call an agent took counts) - rings only that
agent, alone, and a ring they miss is a missed call, not passed on; nobody free, a
missed call. The first to accept takes the call and the lead (`/incoming/claim`,
`takeIncomingCall`, on `takeCallWithLead` like a transfer). How it is rung and ended
- `ringEveryoneTwiml`, the end taken from the whole ring - is in `INCOMING-CALLS.md`,
"Who rings".

The incoming-call card says why they are calling - "Calling back · automated call,
28m ago" when the robot is the only one who called them (`INCOMING-CALLS.md`, "On the
screen").

A call from the lead, answered or not, also stops the text questions: their next text
goes to a person (`STATE-MACHINE.md`, "2d").

## Rules

1. **The switch decides who is rung, not the role.** Off at every sign-in and
   sign-out.
2. **Free is one definition**, `FREE_SQL`: active, switch on, browser ringable, not on
   a call, not being rung from hold. Every ring and the robot's pace read it.
3. **A lead who said yes goes to whoever answers**, taken from anyone who held it;
   the lead's own agent, if free, rings alone first.
4. **Who let a ring run out is decided at the end of the whole ring**, never from one
   person's ring; only they are switched off, and only if still free.
5. **A "yes" waits on hold only while someone is coming for it** - never for nobody -
   and never past the safety stop, `auto_call_hold_max_minutes`.
6. **One offer at a time per lead and per person**, written before Twilio is asked;
   never the same lead twice to one person.
7. **Recorded from the moment a person answers**, the lead on channel 1.

## Data

| What | Where |
|---|---|
| The switch | `users.taking_calls`, `taking_calls_at`, `taking_calls_why` (migration 017) |
| The browser's word | `users.ringable_until` (migration 016) - not in the activity log |
| The transfer | `calls.agent_id` once taken, `script_result` `transferred` or `transfer_missed`; `leads.assigned_to` follows the call |
| The hold line | `calls.held_at` (migration 019); the place-in-line words on the script's row (`hold_next_body`, `hold_place_body`) |
| Each ring from hold | `call_offers` (migration 020): the call, who was rung, when, and how it ended - written once, ended once, never removed |
| The settings | `auto_call_ring_seconds` 25, `auto_call_offer_ring_seconds` 20, `auto_call_hold_max_minutes` 10 |
| Every action | `calls.availability_changed`, `lead.picked_up`, `call.transferred`, `call.held`, `call.taken` (`AUDIT.md`) |

The columns are in `SCHEMA.md`.

## Code

| File | What it does |
|---|---|
| `backend/src/db/presence.ts` | `FREE_SQL`, `RINGABLE_SQL`, `ON_A_CALL_SQL`, `JUST_OFF_A_CALL_SQL`, `TRANSFER_RINGING_SQL`; `freePeople`, `setRingable`, `someoneOnOrJustOffCall`, `switchOffAfterMissedRing` |
| `backend/src/api/taking-calls.ts` | The switch: why it changed, and its activity row |
| `backend/src/api/calls.ts` | `POST /api/calls/ringable`, `POST /api/calls/taking-calls`, `GET /api/calls/config`; either saying someone is free offers them a lead on hold (`offerHoldTo`) |
| `backend/src/db/users.ts` | Where every session ends: the browser's word cleared; every write of the switch, with why |
| `backend/src/core/call-script.ts` | `planTransfer`, `planAfterHolder`, `rangOut`, `planNobodyTook`, `holdGoesOn`, `placeLine`, `pickOffer`, `MAX_RUNG_AT_ONCE` |
| `backend/src/db/auto-calls.ts` | `transferContext`, `takeTransfer`, `transferTakenBy`, `missTransfer`, `holdCall`, `holdState`, `ON_HOLD_SQL` |
| `backend/src/db/claims.ts` | `takeCallWithLead` - one person taking a call with a lead on it, the lead following the call |
| `backend/src/db/hold-offers.ts` | `startOffer`, `endOffer`, `someoneComing`, `OFFER_STALE_SECONDS` |
| `backend/src/db/calls.ts` | Who an incoming call rings; `takeIncomingCall` |
| `backend/src/api/hold-watch.ts` | The hold watcher, `checkHolds` and `offerWaiting` |
| `backend/src/api/left-open.ts` | `closeFromTwilio` - a call ended from Twilio's own record |
| `backend/src/integrations/twilio.ts` | `transferTwiml`, the hold page and `HOLD_MUSIC`, `holdTrackIndex`, `ringEveryoneTwiml` |
| `backend/src/integrations/twilio-calls.ts` | `transferRings`, `recheckHold`, `sendToOffer`, `callEnd` |
| `frontend/src/lib/presence.ts`, `frontend/src/lib/calling.ts` | What keeps this browser busy, and the 30-second report |
| `frontend/src/lib/taking-calls.ts`, `frontend/src/layout/TakingCalls.tsx` | The switch as the server holds it; the switch and its notice in the app bar |
| `frontend/src/lib/caller-context.ts` | "Calling back · automated call, 28m ago"; "Transfer · said yes to the offer" |

## Tests

| What | Where |
|---|---|
| The two minutes; busy, sign-out and deactivation clear it; the switch; who is free, on a call, just off one; the switch off after a ring let run out, in one statement | `scripts/presence-live-check.ts` |
| Who a lead on hold rings, one at a time, never twice to one person; expiry; who is still coming | `scripts/hold-offers-live-check.ts` |
| `takeTransfer`: taking over from the holder, the same request again, a second person refused, the browser's pick-up first, a deactivated account; `missTransfer` never overwriting; on hold the first time only, first in line, hanging up on hold | `scripts/auto-calls-live-check.ts` |
| A call back: holder, last caller, everyone free, nobody free; taken once | `scripts/calls-live-check.ts` |
| `planTransfer`, `planAfterHolder`, `rangOut`, `planNobodyTook`, `holdGoesOn`, `placeLine`, `pickOffer` | `src/core/call-script.test.ts` |
| The webhooks: the transfer, the claim, the ring's end in every way, the hold page, the offer | `src/api/__tests__/auto-call-webhooks.test.ts` |
| The watcher: who it sends back, offers first, one look at a time | `src/api/hold-watch.test.ts` |
| The switch's routes and records | `src/api/__tests__/taking-calls.test.ts` |
| What keeps the browser busy: several reasons at once, listeners told only of a change, `useBusyWhile` following its component | `frontend/src/lib/presence.test.ts` |
| Telling the server whether it can take a call: registered or not, busy at once, every 30 seconds, in order | `frontend/src/lib/calling.device.test.ts` |
| The switch: shown only with automated calls on, flips once saved, one save at a time, a failure leaves it as it was; the server's word taken from the report unless a switch here crossed it; "Missed a transfer" shown for that reason only, gone once switched on | `frontend/src/layout/TakingCalls.test.tsx`, `frontend/src/lib/taking-calls.test.ts` |
| Casey's yes taken by Maya; Riley's rung out, Maya switched off | `npm run e2e`, steps 11 and 12 |

## Not done

- **A lead's own call back does not wait on the hold line** - only transfers wait.
- **Someone free who declined the group ring of a yes**, while someone else was on a
  call, is offered that lead once more, alone, from hold - group rings are not
  offers. Accepted: rare, and a second chance rather than a lost one.
- **Two tabs of one person**: a note box open in one while the other says
  "available" is not seen.

## Decisions

| Decision | By | Date |
|---|---|---|
| The "Taking calls" switch decides who is rung, not the role | Jeel | 2026-10-15 |
| Letting a transfer ring out turns the switch off | Jeel | 2026-10-15 |
| A lead who said yes goes to whoever answered, taken from anyone who held them | Jeel | 2026-10-15 |
| A "yes" nobody takes: the busy line, and the lead first in the agents' queue as "Wants a call" | Jeel | 2026-10-17 |
| The hold music is Twilio's own classical tracks | Jeel | 2026-10-21 |

## History

- 2026-11-27 · Written from `AUTO-CALLS.md`'s "Who is free", "The transfer", "The
  hold line" and "A lead calling back", to the area template; the real-call notes to
  the tickets' *As built*; `takeCallWithLead` and `closeFromTwilio` named; the
  browser's parts ("In the browser", the switch in the app bar) moved in from
  `FRONTEND.md` · docs to the standard · D37, D26
- 2026-11-23 · A transfer and a call back that rang everyone free share one
  `takeCallWithLead` (`db/claims.ts`) · review Q4
- 2026-11-22 · Review fixes: nobody being rung from hold counts as free (H10); an
  accept that waited on the lock while the voicemail message took the call is
  refused (H8); `completed` taken only when the call is someone's (H9); a lead's
  missed call no longer keeps someone "just off a call" (M24); the hold music counted
  by tracks, not minutes - a first track ending between 6:00 and 6:59 began the list
  again (M21); an offer expires 90 seconds on, not a minute - an offer set to ring
  60 seconds expired as it rang (M22); a call whose end never came ended from
  Twilio's record 15 minutes on (`api/left-open.ts`) · review
- 2026-11-13 · A call Seri took counts as a transfer ringing once her part ended with
  `transfer_to_agent` - before, a "yes" during her transfer's ring heard the busy
  line, and she was told nobody was coming; found in the doc check after A20
- 2026-10-24 · A lead calling back whom nobody owns rings everyone free; taking it is
  its own webhook, `/incoming/claim`, and the whole ring's end decides (T19). Another
  robot call's transfer ringing counts as someone coming, and the hold watcher ends a
  held call Twilio says is over (T20 review)
- 2026-10-22 · The next person who comes free gets the waiting lead; someone writing
  the note of a call that just ended keeps a lead waiting, two minutes · T17
- 2026-10-21 · The hold line, the place in line counted from `held_at` in our
  database rather than a Twilio queue (`<Enqueue>`), the watcher's own 30-second
  checks · T16
- 2026-10-20 · The transfer: everyone free (T15a), the lead's own agent first
  (T15b), the switch off after a ring let run out (T15c). Built first with a report
  per person's ring (`/auto/rang`), which switched off a person whose ring a
  colleague's answer cut short; removed, and `/auto/after` decides from the whole
  ring
- 2026-10-18 · The browser says whether it can take a call (T9, migration 016); the
  "Taking calls" switch and `FREE_SQL` (T10, migration 017); a ring to several
  browsers (T11)
