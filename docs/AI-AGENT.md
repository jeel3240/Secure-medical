# AI agent on the automated call (Phase 7)

**Status:** In progress - every part built (A01-A34) and on production with her switch off (A22); switching her on is next, then A23. The build: [the tracker](ai-agent-tickets/README.md).

Seri, from eDrugstore, is an AI agent who runs the automated call (`AUTO-CALLS.md`) from the first word when she is switched on. She opens the call, gives the offer, answers questions, handles objections, and ends every call with one of five actions - a person now, a call back at a time the lead picks, the link, an opt-out, or a goodbye. What follows that action - the transfer, the hold line, the link text, the block, voicemail - is the robot call's own code, and the fixed script stays as her backup. This doc is the call around her; how each reply is made is [AI-BRAIN.md](AI-BRAIN.md), what Twilio and the relay say to each other [AI-RELAY.md](AI-RELAY.md), and what she knows [AI-KNOWLEDGE.md](AI-KNOWLEDGE.md). All her code is in `backend/src/ai/`.

## How it works

### 1. How Seri talks on the call

```
Lead speaks
   → Twilio turns speech into text (Deepgram)
   → our server, over a WebSocket (the relay): the stop check, who is there,
     then her brain - understand, decide, speak - writes her reply as text, streamed
   → our server checks each sentence
   → Twilio speaks it (ElevenLabs voice)
   → the lead hears Seri
```

Twilio's `<Connect><ConversationRelay>` does the listening and speaking; OpenAI only thinks, in text; our server sits in the middle and sees every word both ways. Twilio provides the ElevenLabs voice and Deepgram, so the only accounts are Twilio's and OpenAI's - the key is the client's. The settings - Aria's voice, Flux listening for the end of a thought, stopped only by speech, keys and speaker events sent - are `RELAY_SETTINGS`, in `AI-RELAY.md`, "The settings"; the tone she gives each line is "The tones" there.

**Why ConversationRelay, and not OpenAI's voice-to-voice model** - compared from published tests:

| | ConversationRelay + OpenAI text | OpenAI Realtime |
|---|---|---|
| Speed on real phone calls | About 1 second; Twilio's own test, 0.5 s typical | About 1 second. Faster in the lab, but one independent test of real agents measured 1.6 s on average |
| The lead talking over her | Built in: Twilio says exactly which words the lead heard before cutting in | Built in, but developers report it stops on "hmm" and "okay", and struggles in the first seconds of a call |
| Each sentence checked before it is said | Yes | Not really: it relies on instructions |
| Fits the robot call's code | The session ends into a normal TwiML `action` URL, so the transfer, hold line and link are reused as they are | The call has to be redirected out of a raw audio stream |

#### How a reply is made

`backend/src/ai/conversation.ts`, one `Conversation` per call, behind the relay:

- **Each thing the lead says:** first the stop check, at once and without OpenAI - the script's stop line, then `end` as `opt_out`. Then who is there now (`whoIsThere`, section 3); a failure to read it counts as nobody, so she never promises a transfer. Then the brain, with the call's history: her greeting as Twilio said it, each lead turn with the note of who is there (`leadMessage`), her replies as the lead heard them.
- **The stop check** (`saysStop`, `core/answers.ts`): the script's stop words (`call_scripts.opt_out_words`), read for a conversation - a phrase ("stop calling", "remove me", "don't call") anywhere in what the lead said, a single word ("stop", "unsubscribe") only on its own ("Stop.", "No, stop", "Stop it, please"). So "Do I need to stop my other medicine?" is hers to answer, not an opt-out. Key 9 is a stop too. A stop in other words is caught by the brain's understand step and ends the same way.
- **Her reply, a sentence at a time:** the words are cut into sentences as they arrive (`SentenceSplitter`, `sentences.ts` - "Dr." and "3 p.m." end none); each is checked (`checkSentence`, section 6) and sent the moment it is whole. A sentence the check replaces gets the specialist line for who is there in its place, and is the last of that reply; any action in it waits, since the line asks a question.
- **After her first question, the rest of her reply waits for its end.** If she ends it with an action that waits for the lead's answer - every action but a stop (`waitsForAnswer`, `actions.ts`) - it is never said; otherwise it is said then, while the question is still being spoken, so nothing is slower.
- **Her action** is checked again (`toHandoff`, section 3). Taken: the last line the relay adds when she gave none (`lineToAdd`), the reply closed, then `end` with the action as `handoffData` - Twilio says the whole line first. A goodbye, the link or a call back first waits for Twilio's verdict on who answered (section 2). Refused: the brain was wrong (`ai_policy.guard`) - the refusal is kept in the history, and she speaks again at once without the action, or waits for the lead when her reply asked something; after two refusals in a row she waits.
- **Talked over:** her reply stops at once, the request to OpenAI aborted, and nothing more of it is sent; the history keeps only what Twilio says the lead heard. **Heard anyway:** when Twilio says nothing was heard but her first sentence went out two seconds or more before (`HEARD_ANYWAY_MS`), that sentence counts as heard (`ai_relay.heard_anyway`); sooner, none of it. Only her last reply is touched, whether still being written or all sent.
- **The lead says more before she answers:** what she was writing is dropped, and one reply answers all of it; what she had already said stands.
- **The call over** - a hang-up, the beep: nothing more of a reply is said or carried out, and the sentences already sent are kept as her turn.
- **Kept, every turn** (`call_ai_turns`): her greeting; each lead turn and key; each of her replies as said - her words, without tones - with `latency_ms`, from the lead's words reaching us to her first sentence going out; the relay's own lines, "One moment...", "Hello, are you still there?" and a goodbye, as hers; the notes and her action (`AI-RELAY.md`, "The notes kept as turns"). **Never in the logs:** `ai_relay.reply` holds only its times, how many sentences, whether one was replaced, the filler, the action, how it stopped and how many sentences went unsaid.

### 2. The AI runs the whole call

| | With Seri on |
|---|---|
| The lead picks up | `/auto/answer` connects the call to her instead of asking the script's first question |
| Voicemail | Twilio's machine detection runs as on the script, and a beep replaces the call with the voicemail message (`AUTO-CALL-SCRIPT.md`, "Voicemail"); her ending actions wait for the verdict (below) |
| "Stop" | Her `opt_out` - and the relay's own stop check on every lead turn, whatever the AI would say |
| Transfer, hold line, busy line, link text | Unchanged: her action ends the session, and `/auto/ai-after` runs the robot call's code |
| The script | Only her backup (section 6) |

#### The call goes to her

`/auto/answer` (`backend/src/api/twilio-webhooks.ts`), once it knows the request names our call:

- **The script is read first**, for her too: it is her backup and holds the stop line she says. No script: the call ends quietly.
- **Who takes the call** - `seriGreeting` (`backend/src/ai/answer.ts`): the switch and the key, read on every call (`readAiAgentOn`, section 7). On: the call goes to her. Off, never set, or on without `OPENAI_API_KEY`: the script's first question; on without a key also logs `ai_agent.no_key`, once. The switch unreadable - the database failing - ends the call quietly, as any failure there does.
- **What Twilio is told** - `seriTwiml` (`backend/src/integrations/twilio.ts`): her relay's address, the settings, her greeting - "Hi, is this Dana?" with the lead's first name, "Hi there!" without one - and our row as a `<Parameter>` (`AI-RELAY.md`, "The TwiML"). The relay builds the same greeting from the same name as her first turn. Twilio says it as soon as the relay is connected - no second of quiet first, unlike the script.
- **The call is placed exactly as any robot call** (`automatedCallRequest`), voicemail detection included. Logged: `auto_call.answered`, with `to` - `seri` or `script`.
- **The relay** (`backend/src/ai/relay.ts`) is a WebSocket on the api's own server at `/api/ai/relay`, attached in `api/index.ts` only with automated calls and calling on. A connection must be signed by Twilio for that address (`AI-RELAY.md`, "Who may connect"), and its first message must be `setup`, within 10 seconds, naming our row. `startAiCall` (`relay-store.ts`) marks `ai_started_at` and `ai_knowledge_version` and records `ai_agent.started`, in one transaction - only for an automated call whose `twilio_call_sid` is the one connecting, not yet hers, not ended and with no result. One UPDATE decides, so two connections for one call cannot both start it. With no active script the session is closed before she starts (`ai_relay.no_script`).
- **One message at a time**, in the order they came; turns are written on their own line of writes, in order, and nothing on the call waits for them. A turn the database refuses is logged (`ai_relay.turn_not_saved`) and the call goes on.
- **The text questions stop once the lead has talked to her:** anything said or pressed to her counts as answering the call - `STATE-MACHINE.md`, rule 2d - but not when the voicemail message took her call.

#### Voicemail while she talks

- **The beep decides, as on the script** (`AUTO-CALL-SCRIPT.md`, "Voicemail"): what the lead said to her counts as an answer and a key pressed to her as a key, read from her turns (`call_ai_turns`, `KEY_TURN_PREFIX`).
- **Her ending actions wait for the verdict:** a goodbye (`end_call`, the relay's own included), the link and a call back. Her last line is said and her choice kept at once - a lead who hangs up in the wait still gets the link, as the action URL reads it - but `end` is sent and her part recorded only once Twilio's verdict is in (`calls.answered_by`, asked every half second - `verdictState`), or after 15 seconds without one (`VERDICT_WAIT_MS`). Twilio decides a person a few seconds in, so a person seldom waits; a machine's verdict comes when its greeting ends.
- **The beep in the wait:** the voicemail message has taken the call. She ends nothing, records nothing, and a note says why; the session's end Twilio may still post is ignored (`auto_call.after_takeover`).
- **A transfer and a stop do not wait:** a transfer to a machine is stopped by its beep as on the script, and a stop is honoured at once. A fallback does not wait either.
- **A hang-up while she talks:** `/auto/ai-after` with `completed`; the relay closes with the socket (`ai_relay.closed`, `ended` false).
- **Logged:** `ai_relay.verdict_wait` - how long it waited (`waitedMs`), and what came: `in`, `taken` or `none`.

#### When the line drops

Her call runs over a WebSocket between Twilio and our api, and a deploy restarts the api, which cuts that line. Twilio tries to reconnect (`applicationReconnect`; its side is `AI-RELAY.md`, "How a session ends"), and the relay picks the call back up:

- **Picking the call back up** (`relay.ts`): a `setup` that says `reconnect` asks `resumeAiCall` (`relay-store.ts`) for the call - the same Twilio call, hers, not over - with its row locked, every turn kept so far, and `ai_agent.reconnected` (`callId`, `attempt`, `ended`) recorded, in one transaction. `earlierConversation` (`resume.ts`, pure) rebuilds the history from the turns - her greeting left out, the lead's words with who is there now, her lines, "One moment..." and keys left out, a reply talked over cut to what was heard - and her brain starts from the last record kept (`AI-BRAIN.md`, "Picking a call back up"). No greeting again; the three minutes count from when she took the call; what the lead said after her last reply is answered at once. A `system` turn marks the place.
- **Her action already chosen** - an `action` turn kept - is carried out: `end` sent again with it, `ai_ended_with` recorded once; OpenAI is not asked.
- **A call she never took** - the line dropped before her first connection got that far: she takes it from her greeting. A reconnect for a call that is over, or for another Twilio call, is refused (1008), and so is a first `setup` for a call already hers.
- **One line per call:** a reconnect while this api still holds the old line - the network dropped, not the api - cuts that one first and waits for its turns to be written. A reconnect naming another Twilio call never cuts one.
- **Stopping the api** (`api/index.ts`, on Docker's SIGTERM, which reaches node through `npm run api`): no new connections, then each call's line closed with 1012, "Service Restart", once its turns are written (`Relay.stop`, two seconds at most); a relay connection that arrives meanwhile gets 503, which Twilio tries again. What the lead says as the line closes is kept, and answered after the reconnect. Then the requests under way finish, two seconds at most. Logged `api.stopping`, with how many calls were with her (`seriCalls`).
- **Caddy waits for the api** (`caddy/Caddyfile`, `lb_try_duration 10s`): recreating the api took it down 3.3-3.4 seconds locally, and Twilio's three tries can all fail within two seconds if each is answered 502 at once. Held at Caddy, a try waits up to its 3 seconds for the api, so the three cover about ten seconds. It holds every request to `/api` the same way - Twilio's webhooks during a deploy too; a request the api was already answering when it stopped is not tried again.

### 3. Her five actions

#### How a call goes

Twilio says her greeting ("Hi, is this John?"); then she says who she is and the offer - up to 25% off the first order - and asks whether they're interested. From there the policy decides each reply ([AI-BRAIN.md](AI-BRAIN.md), "Rules"): a yes gets a person now if someone can take the call, else a call back at a time they pick; a no gets why, asked once, and two clear no's a polite goodbye; a question gets the approved answer, then back to the offer; a question she has no answer for, a medical question or an upset caller gets the specialists - a person now, or a call back; "stop calling me" is an opt-out every time; the wrong person only when they say it plainly. She never says "I don't know".

#### Who is there - told to Seri on every turn

Before each reply the server works out who could take the call now (`whoIsThere`, `relay-store.ts`), with the same rules the transfer and the hold line use - so what she is told is what the transfer will find:

| The server sees | Seri |
|---|---|
| **Someone free** (`FREE_SQL`) | Offers a person now → `transfer_to_agent` → the lead's own agent first, then everyone free (`AUTO-CALL-TRANSFER.md`, "The transfer") |
| **Nobody free, but someone coming** - on a call, writing its note, or another robot call's transfer ringing | `transfer_to_agent` all the same → the hold line (`AUTO-CALL-TRANSFER.md`, "The hold line") |
| **Nobody at all** | No transfer: she says everyone is busy and asks when would suit → `book_callback`, in place of the busy line |

If it changes between her words and the transfer, the transfer's own rules decide: the hold line, or the busy line and **Wants a call** in the queue (`QUEUE.md`, "The order"). Her own transfer counts as ringing for another call's "yes" until it is taken, held or missed (`TRANSFER_RINGING_SQL`, `db/presence.ts`; `AUTO-CALL-TRANSFER.md`, "Who is free").

#### The five actions

She ends every call with exactly one. She says her last line herself, in her voice; the relay ends the session with the action as `handoffData`, and Twilio posts to `/auto/ai-after`, which carries it out and says nothing more of its own - only the recording notice before a transfer, and the hold or busy line when the transfer reaches them.

| Action | When | Her last line | What `/auto/ai-after` does | `script_result` |
|---|---|---|---|---|
| `transfer_to_agent` | Wants to order now, or wants a person - and someone is free or coming | "Great, connecting you now." | The recording notice, then the transfer: own agent first, then everyone free, then the hold line or the busy line | `transferred` / `transfer_missed` |
| `book_callback` | Wants a call later, or nobody is there | The time in the lead's own zone, and goodbye | Saves the call back (section 4), hangs up | `callback_booked` |
| `send_link` | Wants to look for themselves | The link is on its way, and goodbye | Texts the link, hangs up | `link_sent` |
| `opt_out` | Asks not to be called | The script's stop line ("Okay, we will not call you again...") | Blocks the number, hangs up | `opted_out` |
| `end_call` | Not interested, wrong person, an emergency, done | Goodbye | Hangs up; her reason - `not_interested`, `wrong_person`, `emergency`, `other` - kept with the action | `not_interested` |

- **The relay's own endings:** `end_call` with a reason she is never offered - `no_response`, the lead silent after "are you still there?", and `time_limit`, the three minutes and the 20 seconds after them run out (`RELAY_END_REASONS`, section 6).
- **Not hers:** `fallback`, when she fails, with why - `model_failed`, `model_slow`, `socket_error` or `relay_failed` from the relay; at the action URL `twilio_failed` (Twilio's side failed before the relay recorded anything), or `no_handoff`, `unreadable_handoff`, `unknown_action` when `HandoffData` cannot be read.
- She has no action for payment, personal details (date of birth, address, card) or prescriptions, so she cannot take them.

#### The handoff

`backend/src/ai/actions.ts` defines the five once, for the relay and the page that carries them out:

- **The JSON** - `{"action":"book_callback","at":"<instant>","timeZone":"America/New_York","reason":"..."}`; `end_call` carries its `reason`. `handoffData` writes it; `fromHandoff` reads Twilio's `HandoffData` back keeping only what it knows - anything missing, unreadable or unknown is a `fallback`, never an error.
- **The guard** - `toHandoff` checks the brain's action against this turn's view of the call before it is taken. Refused: any action but a stop when her reply asked a question anywhere in it (`awaitLead`); a transfer with nobody there; a call back outside the hours, past, under 15 minutes or over 14 days ahead - with what to offer instead - or for a time not said back in the reply the lead has just answered (`saysClock`, `NOT_AGREED`); `end_call` without a known reason.
- **The last line** - `lineToAdd`: when she took the action with no words, the action's own line in her voice (`lastLine` - a call back's says the time as booked); an opt-out in words that lack the stop line gets the stop line after them.

#### After her part: `/auto/ai-after`

`POST /api/webhooks/twilio/auto/ai-after?call=<row>`, the `action` of every call's `<Connect>`. Like every `/auto/*` webhook it is signed by Twilio, kept in `webhook_events`, and 404 while automated calls are off. What follows her part is one pure rule, `afterSeri` (`backend/src/ai/after.ts`); the route carries it out with the script's own code (`planYes`, `yesTwiml`, shared with `/auto/gather`).

| Twilio says | The action carried out |
|---|---|
| `ended` - we ended the session | Hers, from `HandoffData` (`fromHandoff`) |
| `failed` - Twilio's side, or our socket, failed | What the relay had recorded she ended with, if anything; otherwise `fallback`, recorded here as `twilio_failed` so the robot counts it |
| `completed` - the lead hung up | What the relay had recorded (`recordedHandoff`, her last `action` turn) - Twilio sends none. Nothing recorded: nothing is done, and the call's end saves `hung_up` |

On `ended` and `failed` her action is also passed to `endAiCall`: recorded once, by whichever comes first, so a record the relay could not write is not lost.

| Her action | The lead on the line | The lead gone |
|---|---|---|
| `transfer_to_agent` | The recording notice on recorded calls, then the script's transfer as it is: the lead's own agent alone first, everyone free, the hold line, or the busy line and `transfer_missed`. The ring reads "Transfer · said yes to the offer" - her call is the offer, the script's first step (`transferContext`) | Nobody rung; `hung_up` |
| `book_callback` | `callback_booked` and the call back saved together, hang up | The same |
| `send_link` | `link_sent`, hang up, the link texted once Twilio has its answer - only by the request that saved the result | The same |
| `opt_out` | `opted_out`, the number blocked (`call_opt_out`) and the lead's open text conversation ended, as a stop on the script; hang up | The same - a stop said just before hanging up still blocks |
| `end_call` | `not_interested` whatever her reason, except the relay's `no_response`, which is the script's `no_response`; hang up | `not_interested`; `no_response` becomes `hung_up` |
| `fallback` | "Sorry about that." then the script's first question alone - "Are you interested in ordering?" - in the script's voice, listening as on any first asking (`fallbackAsk`); the answer goes to `/auto/gather` and the call carries on as a script call. No script: the call ends | Nothing; `hung_up` |

- **The result is saved once** - `keepCallResult` (`backend/src/db/auto-calls.ts`), the transaction `keepAnswer` uses: the call locked, the result written only if it has none, and a stop's block. A request Twilio sends twice saves and texts nothing the second time.
- **After the voicemail message has taken the call:** nothing is done, `auto_call.after_takeover`, as `/auto/gather` and `/auto/after` do.
- **Logged:** `auto_call.ai_after` - the status, the action, `hungUp`, Twilio's `errorCode` on a failure, `why` for a fallback; then the transfer's own lines. Anything failing: `auto_call.ai_after_failed`, and the call ends quietly.

### 4. Calls back at a time the lead picks

| Step | What happens |
|---|---|
| She books it | A time the lead picked, said back and agreed, and a one-line reason ("Wants to order antibiotics") |
| Whose it is | The lead's own agent, if an active one holds the lead; otherwise **open to everyone** |

**Her two rules when booking:**

1. **Agent hours only:** the robot's own calling hours (the `auto_call_*` settings, read by `readCallHours` - `AUTO-CALLS.md`, "When a lead is called"), weekdays 11 AM to 5 PM Arizona time. "8 PM tonight" gets why, and the next opening.
2. **The lead's time zone:** from the area code, and said back out loud - "So that's Thursday at 3 PM your time?" Agents see it in Arizona time; Arizona keeps no daylight saving, so 3 PM in New York is 1 PM there in winter and 12 PM in summer.

**The time rules** - `backend/src/ai/callback-time.ts`, pure:

- `leadTimeZone` maps 353 area codes to a zone - a code across two zones takes the one most of its people are in. An unknown one gives Arizona's zone and `known: false`, and every time on that call is said as Arizona time - "tomorrow at 2 PM Arizona time" (`FALLBACK_ZONE_SAID`) - so the lead hears the zone and can say another time.
- `checkCallbackTime` accepts a time inside the hours, at least 15 minutes and at most 14 days ahead (`MIN_AHEAD_MINUTES`, `MAX_AHEAD_DAYS`). Refused, it says why - `past`, `too_soon`, `too_far`, `outside_hours` - and offers what a salesperson would: a weekend keeps the time on the lead's clock (Saturday at 3 is Monday at 3), a time outside the hours becomes the next opening (8 PM is tomorrow at 11 Arizona time), past or too soon the first quarter hour far enough ahead, too far the same time on the last day in reach.
- `atLocalTime` reads a wall clock ("2026-11-12T15:00") in a zone; `spokenTime` says it back - "tomorrow at 1 PM your time", "Monday at 3 PM your time", the date from a week on; `saysClock` finds it in her words - "3 PM", "3:00 p.m.", "3pm", "noon", and in words, "twelve PM", "three thirty PM"; the minutes said unless on the hour; a number that only ends in the hour, "thirteen", is not it.
- Holidays are not known, as they are not to the robot's own hours.

**Booking it** - with her result, once, open to everyone or the lead's own agent's, and how it shows and who takes it - is `CALLBACKS.md`, "Seri's call backs"; when it is due, the lead is at the top of the queue (`QUEUE.md`, "The order").

### 5. What Seri knows

Three JSON files in `backend/src/ai/knowledge/` - the approved answers and rules, the products she may name, and the sales playbook - loaded and checked when the api starts; a broken one stops it starting, whether or not she is on. What each holds, which parts a call reads, the versions and where the words came from: [AI-KNOWLEDGE.md](AI-KNOWLEDGE.md).

### 6. Limits and backups

| Situation | What happens |
|---|---|
| The call reaches **3 minutes** | With her next reply she wraps up - one closing offer, then an ending. 20 seconds after the three minutes the relay ends the call itself: `end_call`, `time_limit` |
| The lead silent **6 seconds** after she stops talking | "Hello, are you still there?" Silent 6 seconds more: "Sorry I missed you, have a great day." and `end_call`, `no_response` |
| OpenAI gives no first word in **4 seconds** | "One moment..."; still nothing 4 seconds later: `fallback`, `model_slow` - the script takes the call |
| OpenAI errors, or the socket or the relay fails | `fallback` - `model_failed`, `socket_error`, `relay_failed` - and the script takes the call |
| The line drops - the api restarting, the network | Twilio reconnects and the call is picked back up (section 2, "When the line drops"); the script takes the call only when that fails |
| **OpenAI down before calling** | The robot places no calls (below). Each lead gets one robot call, so a lead is never spent on a broken Seri |
| Her last **3 calls** all fell back | The robot pauses 15 minutes, as when Twilio refuses a call (`REFUSED_PAUSE_MINUTES`) |
| A sentence holds a price, medical advice, a diagnosis or an offer we don't make | It is replaced before it is said (below) |
| Someone else connects to the relay | Refused before any WebSocket opens (`AI-RELAY.md`, "Who may connect") |

- **The clocks** start when `setup` has started her on the call - when Twilio starts her greeting - and all stop the moment her part ends or the socket closes. They run on `timers`, the real clock or one moved by hand in the tests (`fake-clock.ts`); the limits are one constant, `LIMITS`.
- **Silence** needs Twilio's speaker events. It counts only while nobody is talking and she is not answering: from `agentSpeaking` off, from her reply's end if Twilio's off came first, and again from a key. `clientSpeaking` with no words after it - a noise, an "mm" Twilio drops - only holds it, and holds it 4 seconds at most (`noWordsMs`); how long a silence was held is logged with it (`ai_relay.still_there`, `heldMs`). "Are you still there?" is said in her voice, kept as hers and put in the history, so the brain knows she asked; the second 6 seconds count from the end of that line. Anything from the lead - words or a key - puts it right: two silences in a row are needed again.
- **Three minutes:** a marker goes in the history with her next reply, once (`WRAP_UP_NOTE`) - not at the mark itself, when the lead may be about to answer her. The brain reads it and makes the closing offer (`AI-BRAIN.md`, "Rules"); it is never said and never sent to OpenAI. 20 seconds on, if she has not ended the call, a reply she has started is said whole - OpenAI has 10 seconds more at most to finish it (`lastReplyMs`) - then "Thanks so much for your time today. Have a great day!" and `end_call`, `time_limit`; the lead saying more by then gets the goodbye, not a reply.
- **OpenAI slow** is counted from the start of each reply - a refused action's second try has its own. "One moment..." opens her reply, so what she says next follows it; it is kept as her turn with how long it took, but not put in the history, or she would start saying it herself. At 8 seconds the request is stopped, her utterance closed, and the call falls back.
- **Failing:** OpenAI erroring before or during her reply - what she had said is closed first; our socket failing - her part recorded as a fallback, though Twilio no longer hears the `end` and posts `failed`; the relay failing once she is on the call - the session ends with the fallback rather than a dropped socket. Before `setup` has started her there is nothing to end: the socket is closed, and Twilio posts `failed`. The call closing while she thinks - a hang-up, the beep - is not a failure.
- **What is recorded:** every fallback is `calls.ai_ended_with = 'fallback'` and `ai_agent.ended` with `why`. A session that closes with no end of ours is the action URL's to record - Twilio's failure as `twilio_failed`; a hang-up leaves `ai_ended_with` null. `ai_relay.closed` says whether her part had ended.
- **The logs never quote OpenAI's error:** it can hold part of the key ("Incorrect API key provided: sk-abcd*****wxyz"). Only its status and code - `OpenAI 401 invalid_api_key`, `OpenAI timed out` (`plainError`, `openai.ts`).

**The sentence check** - `checkSentence`, `backend/src/ai/safety.ts`, on every sentence before Twilio speaks it. Five reasons: `price` (`$`, "dollars", "USD", "euros", `€`, `£`, an amount with cents, "costs" with a number - not "pounds", a weight as often as money); `advice` ("you should take", "dosage", side effects, how often, interactions); `diagnosis` ("sounds like you have"); `discount` (half off, or made-up urgency such as "today only" - any offer but "up to 25%"); and `cant_answer` ("I don't know", "I can't provide that", "I don't have that information"). The words around a risky word decide, so "I can take you off our list" and "an overdose" pass. A sentence that fails is replaced by the specialist line for who is there (`specialistLine`): "That's a great question for one of our specialists. Would you like me to connect you?" - or, with nobody to take a call, "... Everyone on our team is busy right now - when would be a good time for one of them to call you back?", never "connect you". What it found is kept with the call's turns, never logged. Every line said by code and every line of the knowledge files passes unchanged (`safety.test.ts`).

**The check before calling** - `backend/src/ai/health.ts`, asked by the robot's dialler (`worker/auto-calls.ts`) with her switched on, inside the hours and only when it has room to place calls, so it never asks OpenAI to place nothing:

- **OpenAI answers** - a one-word request to each of her two models, together (`openAiProbe`): speak's with 1 token, understand's with 16, as its reasoning needs a few. 5 seconds at most, no retries; its answer, up or down, kept 60 seconds (`cachedProbe`). Down - an error, a refused key, no answer - and nothing is placed that look; logged once, `ai_agent.openai_down`, with OpenAI's status and code.
- **Her last three calls did not all fall back** (`fallbackStreak`): three whose part ended, all `fallback`, the latest started within 15 minutes - and nothing is placed, OpenAI not asked meanwhile; logged once, `ai_agent.fallbacks_paused`. After the pause the next call tells: another fallback pauses again, anything else ends the streak. A call the lead hung up on before she ended it has no `ai_ended_with`, and neither breaks nor adds to the streak.
- **Off** - the switch, or no key: none of this is asked, and the calls get the script.

### 7. Switches and rollout

| | Where | What |
|---|---|---|
| `OPENAI_API_KEY` | The server's `.env` (and a laptop's), passed to the api and the worker by `docker-compose.yml` (`config.openai.apiKey`) | Never in the repo. **Without it she is off, whatever the switch says** (`ENVIRONMENT.md`) |
| **Her switch** | `settings.ai_agent`, `on` or `off` - changed by `npm run ai-agent -- on` or `-- off` on the server, or by a superadmin's button on Admin > Configuration's Calls tab | On: she runs every robot call. Off: the script. **Read on every call**, so it changes without a restart, and switching off cuts off no live call |

- **Changed only by the command or the button**, never by hand: production's database is changed only by migrations and by the app itself. The exact commands are `DEPLOY.md`'s.
- **The button** - **Switch on** or **Switch off** on the Seri card of the Calls tab, superadmin only, confirmed first - lets her be stopped from any browser, by someone who cannot reach the server. `POST /api/admin/config/ai-agent` (`api/admin/config.ts`), through the same `switchAiAgent` as the command; on is refused without the key (`409 no_key`), off is always allowed. The card says what follows: robot calls go to Seri, use the script, get the script for want of a key, or none go at all with automated calls off (`ADMIN.md`).
- **Each change is recorded** - `ai_agent.switched` in the activity log, what it was and what it became, in the same transaction as the change, with `via: 'command'` or `via: 'website'` and the superadmin as the actor (`AUDIT.md`); logged `ai_agent.switched`. Switching to what it already is changes nothing and records nothing; two at once take turns.
- **`on` is refused without `OPENAI_API_KEY`**, and nothing is written. **On without a key counts as off** - the key taken out of `.env` after switching on, say: calls go to the script, and the first such call logs `ai_agent.no_key` once.
- **Not a reason to refuse to start**, unlike a half-set Twilio group (`api/startup-checks.ts`): the switch changes while the api runs, so a start-up check would catch it only at the next restart - and would take down the queue, the texts and every screen for something whose fallback is the script.
- **Packages:** `openai` 6.x and `ws` 8, with `@types/ws`. `openai` 7 needs Node 22, and the app runs Node 20 (`node:20-alpine`), so it stays on 6 until Node is upgraded - a change of its own.
- **The Twilio account** must have completed ConversationRelay's onboarding, accepting Twilio's AI features addendum, or every `<ConversationRelay>` call fails (`TWILIO-SETUP.md`).

**Rollout:** built and tested on the dev number, (480) 530-8582; deployed with her off, so calls work as before; then switched on, and every call goes to her - no partial share, no comparison report. Outside production the robot rings only `AUTO_CALL_TEST_NUMBERS`, so she can reach only our own phones while testing. How calls went is analysed by hand when wanted: every turn is in the database.

## Rules

1. **Every call she takes ends with exactly one of her five actions**, or the fallback to the script - never with nothing.
2. **A stop is honoured at once**, without OpenAI, whatever she is saying: the script's stop words or key 9 end the call as an opt-out.
3. **Every sentence is checked before it is said.**
4. **No transfer, and no offer of a person, with nobody there** to take the call.
5. **A call back is booked only inside the agent hours**, 15 minutes to 14 days ahead, and only for a time she said back and the lead agreed.
6. **No action after a question in the same reply**, except a stop: the lead answers first.
7. **A goodbye, the link or a call back waits for Twilio's verdict**, up to 15 seconds, so a voicemail still gets its message; a transfer and a stop do not wait.
8. **With her off, or no key, nothing changes:** the script takes every call, and OpenAI is never asked.
9. **The robot places no call** while OpenAI does not answer, or for 15 minutes after her last three calls all fell back.
10. **Her words are never in the logs** - only in `call_ai_turns`; OpenAI's errors only as status and code.
11. **No payment, personal details or prescriptions:** she has no action for them.
12. **All AI code lives in `backend/src/ai/`**, apart from the hooks listed under "Code".

## Data

Following `AUDIT.md`: nothing is lost, everything add-only. The columns and their constraints are `SCHEMA.md`'s (migrations 022 to 024).

| Where | What |
|---|---|
| `calls.ai_started_at`, `calls.ai_knowledge_version` | When she took the call, and which version of her knowledge - written together, only on an automated call |
| `calls.ai_ended_with` | How her part ended: one of the five actions, or `fallback`; null when the lead hung up first. A call that fell back then gets the script's own `script_result`, so this is the only record that she failed - the robot counts it. Written by the relay when she acts - a goodbye, the link or a call back only once Twilio's verdict is in, and not at all when the voicemail message took the call - and for every fallback it decides; by the action URL too, whichever comes first |
| `calls.script_result` | `callback_booked` beside the script's results |
| `call_ai_turns` | One add-only row per turn: the call, who (`lead`, `seri`, `action`, `system`), the text, when, and `latency_ms` on hers; `data` only on the brain's record of a reply (`AI-BRAIN.md`, "Data") |
| `callbacks` | Her bookings: `reason = 'ai_booked'` - the only kind that may have no agent - with `booked_by_call_id` and her `note`, one per call |
| `settings.ai_agent` | Her switch; migration 022 seeds it `off`, never over a value already written |

- **The activity log** (`AUDIT.md`): `ai_agent.switched`; `ai_agent.started`, once per call; `ai_agent.ended`, with the action, `why` for a fallback and `reason` for `end_call`; `ai_agent.reconnected`, up to five per call; `callback.booked` with `via: 'seri'`; `callback.taken` when an agent picks the lead up (`CALLBACKS.md`).
- **The logs** (`LOGGING.md`): `ai_relay.*`, `ai_agent.*`, `ai_brain.turn`, `ai_policy.guard`, `auto_call.answered`, `auto_call.ai_after` - times, counts and outcomes, never her words or the lead's, the same rule as `auto_call.answer`.
- **On screen:** under the robot call on the lead's timeline, a fold of its own, **Seri** - her conversation and how her part ended, for the agent who takes the transfer or the call back, so the lead does not repeat themselves (`TIMELINE.md`, "A call Seri took"). Her call back on the lead's page and in Admin > Leads' Call column (`CALLBACKS.md`, "Seri's call backs"); her switch on Admin > Configuration (`ADMIN.md`). Nothing else new on Admin.

## Code

| File | What it does |
|---|---|
| `backend/src/ai/settings.ts` | Her switch: reading it (`readAiAgentOn`), changing it (`switchAiAgent`) |
| `backend/src/ai/answer.ts` | Whether an answered call goes to her, and her greeting (`seriGreeting`) |
| `backend/src/ai/relay.ts` | The WebSocket: who may connect, which call, every turn kept, picking a call back up, stopping |
| `backend/src/ai/relay-messages.ts` | What Twilio sends, read; what the relay sends; `RELAY_SETTINGS`; the notes kept as turns (`AI-RELAY.md`) |
| `backend/src/ai/relay-store.ts` | The relay's SQL: `startAiCall`, `resumeAiCall`, `saveTurn`, `whoIsThere`, `endAiCall`, `verdictState`, `recordedHandoff` |
| `backend/src/ai/resume.ts` | The history rebuilt from the kept turns, pure |
| `backend/src/ai/conversation.ts` | One call's conversation: the stop check, sentences checked and sent, talked over, the action, the limits, the voicemail wait |
| `backend/src/ai/sentences.ts` | Her streamed words cut into sentences; `asks` |
| `backend/src/ai/tone.ts` | Her tones; her words without them (`AI-RELAY.md`, "The tones") |
| `backend/src/ai/safety.ts` | The sentence check and the specialist line |
| `backend/src/ai/actions.ts` | Her five actions: the handoff, the guard, the last lines |
| `backend/src/ai/after.ts` | What follows her part, pure (`afterSeri`, `fallbackAsk`) |
| `backend/src/ai/callback-time.ts` | When a call back may be booked, the lead's zone, how a time is said |
| `backend/src/ai/health.ts` | The check before the robot calls |
| `backend/src/ai/fake-clock.ts` | The clock the tests move by hand |
| `backend/src/ai/brain.ts`, `understand.ts`, `policy.ts`, `speak.ts`, `instructions.ts`, `openai.ts`, `model.ts`, `evals/` | Her brain - `AI-BRAIN.md` |
| `backend/src/ai/knowledge.ts`, `knowledge/` | What she knows - `AI-KNOWLEDGE.md` |
| `backend/src/cli/ai-agent.ts` | The switch's command |

**The hooks outside `backend/src/ai/`:** `/auto/answer` and `/auto/ai-after` (`api/twilio-webhooks.ts`) and her TwiML (`seriTwiml`, `integrations/twilio.ts`); the relay and her brain wired in `api/index.ts`; the key in `api/deps.ts` and `config.ts`; the button's route (`api/admin/config.ts`); the check before calling (`worker/index.ts`, `worker/auto-calls.ts`); her result and call backs (`db/auto-calls.ts`, `db/callbacks.ts`); the voicemail rule with her turns (`db/auto-calls.ts`); who is coming (`db/presence.ts`); the queue and claiming (`db/queue.ts`, `db/lead-state.ts`, `core/queue-tags.ts`, `db/claims.ts`); the timeline (`db/timeline.ts`); the stop check (`saysStop`, `core/answers.ts`); the activity actions (`core/activity.ts`); and on the frontend `SeriConversation.tsx`, the lead page's badge and the switch's card.

## Tests

| What | Where |
|---|---|
| The switch: what each stored value means, the key | `settings.test.ts` |
| The handoff both ways, every refusal, the last lines | `actions.test.ts` |
| Call-back times: zones, the hours, every refusal and what it offers, saying a time and finding it | `callback-time.test.ts` |
| The sentence check: every reason, the words around them, every line said by code and in the knowledge files passing | `safety.test.ts` |
| One call's conversation against a fake brain and a clock moved by hand: sentences, a replaced one, talked over, heard anyway, the lead saying more, the action and its refusals, the stop check, silence, the three minutes, slow and failing, the voicemail wait, the call closing | `conversation.test.ts` |
| The relay over a real WebSocket on a real server, a fake ConversationRelay sending A02's messages: setup, turns, each action, a stop, a failure, picked back up, one line per call, stopping | `relay.test.ts`, `relay-messages.test.ts`, `resume.test.ts` |
| What follows her part, every action with the lead on the line and gone | `after.test.ts` |
| The routes: `/auto/answer` on, off, never set, without a key, no script, the switch unreadable; `/auto/ai-after` for each action, the fallback from the relay, from Twilio and from unreadable data, a hang-up after a stop and after the link, the voicemail's takeover | `api/__tests__/auto-call-webhooks.test.ts` |
| Her TwiML word for word | `integrations/twilio.test.ts` |
| The check before calling: up, a refused key, the cache, the order of the questions | `health.test.ts` |
| The button and its card | `api/__tests__/admin-screens.test.ts`, `frontend/src/pages/admin/ConfigSeri.test.tsx` |
| Her conversation under the call | `frontend/src/components/SeriConversation.test.tsx` |
| On a real Postgres: starting once, two connections racing, each refusal, turns in order, picking back up, who is there, her result once, the block once, her call backs, the fallback streak, the voicemail rule with her turns, the brain's record | `scripts/ai-agent-live-check.ts`; also `queue-live-check`, `agent-sms-live-check` (rule 2d), `presence-live-check` (her transfer ringing), `activity-live-check`, `admin-live-check` |
| End to end, Twilio stubbed at its HTTP edge and OpenAI a local server: switched on with the command's own function; the robot placing nothing while OpenAI does not answer, then calling again; her calls through her real relay - a call back (booked, due, first in the queue, taken on pick-up, on My Callbacks), a transfer taken, the link texted once, a stop with no OpenAI asked, the understand step failing into the script, and the api stopped mid-call with the call picked up by a fresh relay | `npm run e2e` |
| Her brain - understand, decide, speak, and the test sets run against OpenAI | `AI-BRAIN.md`, "Tests" |
| Every path on a real phone, on the dev number: A21's checklist, walked again as A34 on calls 113-140 - the three minutes left to the tests; the api restarted mid-call and the call picked back up, heard on call 92 | `ai-agent-tickets/A21-every-path-on-a-real-phone.md`, `ai-agent-tickets/A34-a21-walked-again.md` |

## Not done

- **Not in this phase:** a self-improving AI that learns why leads hang up or say no - a future phase; Seri answering a lead calling back when nobody is free, or out of hours; languages other than English. Taking payment or personal details - never.
- **Open:** "What is Medical Web?" (the caller ID's name) - until the client confirms it, she says only `medical_web`'s fallback, "We're calling on behalf of eDrugstore."
- **Switching her on** on production, and watching the first calls - A22. **A voicemail's menu** ("press 1") taken for a "yes" and put through, seen twice on production on the script - A23, after A22.
- **What is said over her and does not stop her** is held by Twilio until she stops, and then reaches her as an answer to the question she ended on - "okay" during the offer taken as interest (A21's calls 99, 100). It cannot be told from an answer said after her question; the harm is small - she asks why, offers once, and a lead who says "no, I said okay" is answered - so nothing was changed.
- **A lead who says "stop calling me" and hangs up at once**, before Twilio has passed the words to the relay: nothing blocks the number. On the script Twilio still posts what was heard after a hang-up.
- **OpenAI stalling partway through a reply**, after its first word: the 15-second request timeout does not cover a stream that stalls, so only the time limit ends such a call, three and a half minutes in at the latest. A reply with neither words nor an action says nothing, and the silence then asks "are you still there?" (`ai_relay.empty_reply`).
- **A beep after her goodbye has gone and the 15 seconds are over:** the call has ended by then.
- **Caddy itself restarting** mid-call - a deploy that rebuilds the frontend recreates it - drops its line to Twilio with nothing holding the reconnect. It starts in about a second, inside Twilio's first two tries, but this is untested. What Twilio plays during a reconnect's gap: silence, as far as call 92 told.
- **A reply she was in the middle of when the line dropped:** the sentences already sent are kept as her turn, so she does not answer again - and her record counts that reply as said, a question at its end she never reached included; the lead's next words, or the silence's "are you still there?", carry the call on. Not heard on a real call.
- **The three minutes** were not heard on a real phone - every long test call ended first; they are left to the tests that move the clock by hand.
- **The switch's button** has its tests but was not yet seen in a browser.
- **Holidays** are not known to her call backs, as they are not to the robot's hours.

## Decisions

| Decision | By | Date |
|---|---|---|
| The AI runs the call from the start ("run from start") | Client | 2026-11-05 |
| A medical question or an upset caller: a specialist now, or a call back | Client | 2026-11-05 |
| Twilio ConversationRelay with an OpenAI text model and an ElevenLabs voice, not OpenAI's voice-to-voice | Jeel | 2026-11-11 |
| The AI runs the whole call; the script only its backup - reversing "keep the script, hand off when off-script" of 2026-11-04 | Jeel | 2026-11-11 |
| She follows a sales playbook, knows on every turn whether anyone can take the call, and ends every call with one of five actions | Jeel | 2026-11-11 |
| She can book a call back at a time the lead picks, and it reaches agents when due | Jeel | 2026-11-11 |
| What she knows is three JSON files, not database tables | Jeel | 2026-11-11 |
| A 3-minute limit; OpenAI checked before calling; any failure falls back to the script | Jeel | 2026-11-11 |
| Tested on the dev number, deployed off, then switched on for every call - no partial share, no comparison report | Jeel | 2026-11-11 |
| The switch is a server command, not a hand edit | Jeel | 2026-11-11 |
| She says she is eDrugstore's virtual assistant if asked whether she is a person | Jeel | 2026-11-11 |
| Her voice Aria, with a tone line by line at stability 0.4 | Jeel | 2026-11-13 |
| The relay picks a call back up when the line drops, so a deploy mid-call keeps it | Jeel | 2026-11-13 |
| A voicemail's menu (A23) after the main AI agent work | Jeel | 2026-11-16 |
| Each reply in three steps - understand, decide in code, speak (`AI-BRAIN.md`, "Decisions") | Jeel | 2026-11-17 |
| The three minutes left to the tests, not heard on a real phone | Jeel | 2026-11-22 |
| Her switch also a superadmin's button on Admin > Configuration | Jeel | 2026-11-24 |

## History

- 2026-11-27 · Rewritten to the Area template: the brain (section 12) to `AI-BRAIN.md`; the relay's settings, the TwiML, Twilio's messages and her tones to `AI-RELAY.md`; what she knows (section 5) to `AI-KNOWLEDGE.md`; section 8 is "Tests", section 9 "Data", sections 10 and 11 "Not done"; the call-by-call notes to the As built of A02, A09, A21 and A34; each ticket's build notes left in its ticket; "The seven decisions" (eight rows) into "Decisions"; the "Build tracker" section dropped - it said 22 tickets, and the tracker is the tracker. Fixed: lines that described the removed one-request brain - her instructions of about 3,500 words, the actions as OpenAI tools, the notes after the lead's turns; `Caddyfile` for `caddy/Caddyfile`; the TwiML's greeting, sent with its tone · D43, D42
- 2026-11-24 · On production through PR #31, migrations 022-024, with her switch off; the key set in the server's `.env`. Her switch on Admin > Configuration's Calls tab, beside the command · A22
- 2026-11-23 · After the review (`docs/REVIEW-2026-11-22.md`): `caddy/Caddyfile` in its own folder, mounted and watched, so a pull that changes it reaches Caddy by itself (Q11); a deactivated agent's call back counts as nobody's (D2); the docs read again against the code (R1-R9)
- 2026-11-22 · Review fixes in the call around her: a reply she was in the middle of when the lead hung up, or the line dropped, kept as her turn - before, it was lost and after a reconnect she answered the lead's words again (M6); "USD", "euros", `€` and `£` prices (M7); an unknown area code's time said as Arizona time - before, nothing made her ask and a lead in New York heard 2 PM Arizona as their 2 PM (H11) · `docs/REVIEW-2026-11-22.md`
- 2026-11-19 · The one-request brain removed (`AI-BRAIN.md`, History). With it went: the call's history starting with her whole instructions, built for the call (`buildInstructions` - who she is, how she speaks, the call, the notes of who is there, the five actions, the rules, the objections, the closing questions, every answer and product, then "## This call"; every call on a server shared its first 19,000 characters or so); the five actions as OpenAI tools in strict mode, and an action written in brackets taken all the same; the notes with the lead's turns; the wrap-up note sent to OpenAI, now only a marker; the answer test set. Kept, as the guard on the brain's action: `lineToAdd` and `toHandoff`'s rules that the answer test set had led to - the lead always hears a last line, and an action after a question waits · A34
- 2026-11-17 · A21 paused after call 112, and the brain rebuilt as three steps, A24-A33 (`AI-BRAIN.md`); A34 walked A21's checklist again on it, calls 113-140, done 2026-11-23. Before the new brain: silence held, not started again, by the lead "talking" with no words, and the specialist line never offering a person with nobody free (A25) · A24-A34
- 2026-11-13 · The line dropping handled, after Twilio's warning on call 91: before, the relay took a call once and refused Twilio's reconnect, so a deploy mid-call handed the lead "Sorry about that." and the script, or Twilio's application error if the api was still down; heard working on call 92 · A21
- 2026-11-13 · Found in the doc check after A20: a lead who talked to her had the text questions stop (rule 2d); her transfer counts as ringing for another call's "yes" - before, only the script's did, so while her transfer rang another call's "yes" heard the busy line · A20
- 2026-11-13 · A21's real calls began on the dev number: Aria and her tones, and the fixes after calls 89-111 - each in A21's As built · A21
- 2026-11-12 · A02's first test calls picked her voice (Rachel, then) and confirmed the relay's ground (`AI-RELAY.md`); A10-A20 built - the relay, her talking (her first sentence 0.66-0.90 s after the lead's words on the real API), its limits, the call going to her, what follows her part, her call backs and their place in the queue, the check before calling, voicemail while she talks, her conversation on the timeline, `npm run e2e` with her calls - each ticket's As built has its build notes. The wrap-up note was tried on the real model before it was kept: the first wording let her text the link with nobody there without asking · A02, A10-A20
- 2026-11-11 · A01 and A03-A09: the key and the switch, the knowledge loader, her instructions, the sentence check, her five actions (then OpenAI tools in strict mode), the call-back time rules, migration 022, and the answer test set, which chose `gpt-4.1-mini` - 133 of 134 cases, first word in 0.55 s (A09) · A01, A03-A09
- 2026-11-11 · Designed with Jeel. Why: the automated call was a fixed script that understands "yes", "no", "stop" and the keys 1, 2 and 9, and asks anything else once more before ending; on its first day, 250 calls, 82 leads hung up - most during the robotic opening, before saying anything - and 65 ended `no_response`. A hybrid that kept the script and handed off when off-script could not help those 82, and the script's voice and hers would change mid-call · the client's request, 2026-11-05
