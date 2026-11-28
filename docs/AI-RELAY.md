# Seri's relay: settings and messages

What Twilio and our relay say to each other on a call with Seri: the ConversationRelay settings every call uses (`RELAY_SETTINGS`), the TwiML that hands a call to her (`seriTwiml`), every message each side sends, how a session ends, the tones the voice takes, the notes kept as turns, and what was measured on the dev number. The code is `backend/src/ai/relay-messages.ts`, `backend/src/ai/tone.ts` and `seriTwiml` in `backend/src/integrations/twilio.ts`; the shapes are as they arrived on the dev number's test calls (A02), not as guessed from Twilio's docs. What the relay does with them is [AI-AGENT.md](AI-AGENT.md), sections 1, 2 and 6.

## The settings

Every call to Seri is connected with these, `RELAY_SETTINGS`, written as the test calls wrote them - `ignoreBackchannel`, not the `twilio` library's `ignorebackchannel`:

```
ttsProvider="ElevenLabs" voice="9BWtsMINqrJLrRacOk9x-v4-0.4_0.8"
transcriptionProvider="Deepgram" speechModel="flux"
interruptible="speech" interruptSensitivity="low" ignoreBackchannel="true"
elevenlabsTextNormalization="on" dtmfDetection="true" events="speaker-events"
applicationReconnect="true" partialPrompts="true" eotThreshold="0.6"
```

| Attribute | Value | What it does | Chosen on |
|---|---|---|---|
| `ttsProvider` | `ElevenLabs` | Her voice. Provided by Twilio: no ElevenLabs account. It exists only inside the session - a TwiML `<Say>` cannot use it - so she says her own last line before the session ends | A02 |
| `voice` | `9BWtsMINqrJLrRacOk9x-v4-0.4_0.8` | Aria: the voice id, the model (`v4`), stability 0.4, similarity 0.8 - a little livelier than the default, still the same voice. With no model named Twilio uses ElevenLabs's oldest English model, `flash_v2`, which sounded less human; with `v4` (and `v3`) the speed must be left out or be 1.0 | A21's calls 86-90 (Aria), A02 (`v4`) |
| `transcriptionProvider` | `Deepgram` | Speech to text. Provided by Twilio too | A02 |
| `speechModel` | `flux` | Waits for the end of a thought. Deepgram's default, `nova-3`, took a short pause mid-sentence for the end and sent the two halves as two prompts | A02 |
| `interruptible` | `speech` | She keeps listening while she talks and stops the moment the lead speaks; the part she never said is cut from what she said | A02 |
| `interruptSensitivity` | `low` | Clear speech before she stops. Not tested on its own | A02 |
| `ignoreBackchannel` | `true` | "Uh huh" and "okay" while she talks do not stop her - held until she stops (below, "What Twilio sends") | A02 |
| `elevenlabsTextNormalization` | `on` | Numbers and short forms read as words. Not tested on its own | A02 |
| `dtmfDetection` | `true` | Key presses sent over the WebSocket | A02 |
| `events` | `speaker-events` | `agentSpeaking` and `clientSpeaking` - how the relay knows she has stopped; the silence count needs them | A02, A12 |
| `applicationReconnect` | `true` | Twilio reconnects if our WebSocket drops - an api restart. When `false`, the default, the call ends `failed`. Twilio's XML check logs a warning (12200) that the attribute is not allowed on `<ConversationRelay>`; it is in Twilio's ConversationRelay reference all the same, and the calls are unaffected | A13, A21's call 91 |
| `partialPrompts` | `true` | The lead's words while they are still speaking, `last` false: understanding starts on them, and is kept when the final words match | A33 |
| `eotThreshold` | `0.6` | How sure Flux must be that the lead has finished before Twilio sends their words - 0.5 to 0.9, Twilio's default 0.8. Lower sends them sooner, but may take a pause mid-sentence for the end; a pause of about a second said on purpose mid-question still came as one turn | A33, call 119 |

**The greeting** is not in `RELAY_SETTINGS`: `seriTwiml` sets `welcomeGreeting` for each call, below. Like every other line it can be talked over (Twilio's default, `welcomeGreetingInterruptible="any"`).

**Not used:** Smart Turn Detection (`turnDetection="true"`) does not apply with Flux, which keeps its own end of turn; only `nova-3` can use it, and `nova-3` without it cut sentences in half.

## The TwiML

`seriTwiml`, which `/auto/answer` sends in place of the script's first question when the call goes to her (`AI-AGENT.md`, section 2):

```xml
<Response>
  <Connect action="https://<our address>/api/webhooks/twilio/auto/ai-after?call=42" method="POST">
    <ConversationRelay url="wss://<our address>/api/ai/relay"
        welcomeGreeting="[friendly] Hi, is this Dana?" ...the settings above...>
      <Parameter name="call" value="42"/>
    </ConversationRelay>
  </Connect>
</Response>
```

| Part | What it is |
|---|---|
| `action` | `/auto/ai-after` (`AUTO_AI_AFTER_PATH`) with our `calls` row - where Twilio posts when the session ends |
| `url` | `PUBLIC_URL` as `wss://`, then `RELAY_PATH`, `/api/ai/relay` (`relayUrl`). Under `/api`, so Caddy's `/api/*` rule passes the WebSocket as it is. It carries no query: Twilio signs the address as written |
| `welcomeGreeting` | "Hi, is this Dana?" with the lead's first name made fit to say (`cleanFirstName`), "Hi there!" without one (`welcomeGreeting`, `backend/src/ai/instructions.ts`), with her friendly tone (`greetingWithTone`). Twilio says it the moment the relay is connected, with no wait on OpenAI |
| `<Parameter name="call">` | Our row (`CALL_PARAMETER`); it arrives in `setup` under `customParameters` |

## Who may connect

The WebSocket request carries `X-Twilio-Signature`, signed for the `wss://` address exactly as written in the TwiML, query string included, with no parameters (`{}`). The same address with `https://`, or without its query, does not match. `relaySigned` rebuilds the address from `PUBLIC_URL`, never from the request's own host, as every webhook's check does (`isFromTwilio`).

| The relay answers | When |
|---|---|
| 403, before any WebSocket opens | No signature, or one for another address |
| 404 | Another path |
| 503 | The api is stopping - Twilio tries again |
| close 1008 | No `setup` within 10 seconds, a first message that is not `setup`, or a `setup` naming a call that is not ours to take - another Twilio call's, one already hers, one over (`ai_relay.refused`, with why) |
| close 1011 | There is no active script (`ai_relay.no_script`), or the relay failed before she was on the call |
| close 1012, "Service Restart" | The api is stopping: each call's turns written first - Twilio keeps the call and reconnects |

## What Twilio sends

| Message | As it arrives | Read as (`parseRelayMessage`) | The relay |
|---|---|---|---|
| `setup` | `sessionId`, `callSid`, `parentCallSid`, `from`, `to`, `forwardedFrom`, `callerName`, `direction`, `callType` (`PSTN`), `callStatus` (`IN_PROGRESS`), `accountSid`, and `customParameters` - each `<Parameter>` by name. After a drop, also `connectionType: "reconnect"` and `reconnectAttempt` | `setup` - `callSid`, `callId`, `reconnect`, `attempt` | Starts her on the call, or picks it back up |
| `prompt` | `{ "type": "prompt", "voicePrompt": "How can you help me?", "lang": "en-US", "last": true }` - `lang` is `en` with `flux`; `last: false` is a partial, sent with `partialPrompts` | `prompt` - `text`, `last` | Final words: a turn, hers to answer. Partial: a head start for understanding, nothing else |
| `info` | `{ "type": "info", "name": "agentSpeaking", "value": "on" }` - `clientSpeaking` the same way, `off` when it stops | `speaking` - `who`, `on` | The silence count; not kept |
| `interrupt` | `{ "type": "interrupt", "utteranceUntilInterrupt": "...what she had said...", "durationUntilInterruptMs": 8636 }` | `interrupt` - `heard`, `durationMs` | Her reply stops; only what was heard counts as said |
| `dtmf` | `{ "type": "dtmf", "digit": "1" }` | `dtmf` | Kept as the lead's turn; 9 is a stop |
| `error` | `description` | `error` | Kept as a note, never logged: it can quote her words |
| anything else | | `other` | Not used |

Three things the messages do not say:

- **What is said over her and does not stop her** (`ignoreBackchannel`) is held until she stops talking. Twilio then drops it as a backchannel, or sends it as the lead's answer to the question she ended on - an "Okay." said during the offer reached her about four seconds after it ended (A21's calls 99 and 100). The speaker events arrive with the words, on and off in the same millisecond, not while the lead talks; and `reportInputDuringAgentSpeech` (default `none`) would not help an "okay" still being said when she stops.
- **An `interrupt` can say nothing was heard** after seconds of speech (calls 117, 122, 136, 137). The relay's rule for it, "heard anyway", is `AI-AGENT.md`, section 1.
- **The lead hanging up** sends nothing here: the session's end goes to the action URL.

## What the relay sends

| Message | As sent | When |
|---|---|---|
| `text` | `{ "type": "text", "token": "...", "last": false }` (`textMessage`) | Her reply a sentence at a time, then an empty `last: true` to close it; a line said on its own is one message, `last: true` |
| `end` | `{ "type": "end", "handoffData": "<her action as JSON>" }` (`endMessage`) | Her part is over. Twilio says the whole line first: a 13-second line with `end` sent straight after it was heard to the last word; Twilio ends the session about a second after `agentSpeaking` off |

## How a session ends

Twilio requests the `<Connect>` action URL, `/auto/ai-after`, with `SessionStatus`:

| `SessionStatus` | When | Also sent |
|---|---|---|
| `ended` | We sent `end` | `HandoffData` - ours |
| `failed` | Twilio's side, or our socket, failed - and every reconnect try | `ErrorCode` |
| `completed` | The lead hung up | `CallStatus=completed`, no `HandoffData` |

| Twilio error | Seen when |
|---|---|
| 64105 | Our WebSocket dropped mid-call - then the action URL |
| 64112 | "Error converting tokens to speech" - ElevenLabs's `v3_conversational` model, which would not play at all |
| 12200 | The XML warning about `applicationReconnect`, on every call |

**The reconnect, Twilio's side** ([its best practices](https://www.twilio.com/docs/voice/conversationrelay/best-practices#handling-connection-drops)): our line closing with 1001, 1006, 1011, 1012 or 1013, or no answer to its pings for 45 seconds, starts a reconnect - up to 3 tries, 0.5 then 1 second apart, 3 seconds each, and at most 5 reconnects a call. Meanwhile Twilio keeps the call, holds up to 500 events (10 seconds) of what the lead says, and replays them after the new `setup`. A 4xx answer other than 408 or 429 stops it; any other close code of ours ends the call. All tries failing ends the call `failed`. Our side - picking the call back up - is `AI-AGENT.md`, "When the line drops".

## The tones

ElevenLabs's `v4` takes a direction in square brackets inside the text - "[understanding] No problem." - and says what follows that way; the brackets are not said ([Twilio's voice configuration](https://www.twilio.com/docs/voice/conversationrelay/voice-configuration): no fixed list, an unknown one may be said aloud, lower stability follows them more freely). The tones she may use are one list, `TONES` (`backend/src/ai/tone.ts`), for speak's persona ("How you sound", `speakSystem`) and for the check:

| Tone | When |
|---|---|
| `[friendly]` | Hello, thanks and goodbye |
| `[friendly, upbeat]` | Saying who she is, and the offer |
| `[curious]` | Asking the lead something |
| `[cheerfully]` | Good news - they said yes, a call back is booked, she is connecting them |
| `[understanding]` | They are busy, unwell, unsure or not interested |
| `[reassuring, calm]` | They are worried, suspicious or upset, or it may be an emergency |
| `[apologetic]` | The wrong person, or a mistake on our side |

- **What the voice is sent** (`withTone`): her words with tones on the list only - written one way, up to three words of them; every other bracket dropped, never said - a tone she made up, or the note of who is there read back.
- **What is kept** (`spokenWords`): her words alone. That is what the sentence check reads, what `call_ai_turns` holds and what the timeline shows. Which tone a line had is not kept anywhere, and the logs never hold words.
- **Approved answers** are said in a tone chosen by their topic (`answerLine`, `backend/src/ai/speak.ts`): calm for medical, safety and privacy, sorry for an upset caller, friendly otherwise. Her greeting is `[friendly]` (`greetingWithTone`).
- Twilio warns a tone can be said aloud or add breathy sounds; none was heard on the test calls.

## The notes kept as turns

Every turn is a row of `call_ai_turns` (`SCHEMA.md`). Besides the lead's words and hers, the relay keeps these:

| Who | Text | Written by |
|---|---|---|
| `lead` | `(pressed 1)` - a key | `keyTurn`; `KEY_TURN_PREFIX` is how the voicemail rule finds one |
| `seri` | `One moment...`, `Hello, are you still there?`, and the goodbye when the relay ends the call | `FILLER_LINE`, `STILL_THERE_LINE` (`conversation.ts`), `lastLine` (`actions.ts`) |
| `action` | Her action as its `handoffData` | the relay, when her part ends |
| `system` | `Cut off. Heard: "..."` | `interruptedNote` |
| `system` | `Reconnected: the line to our server dropped, and the call was picked back up (attempt 2).` | `reconnectedNote` |
| `system` | `Twilio error: ...` | `twilioErrorNote` |
| `system` | `Replaced (price, "$"): ...` - why, the words found, the sentence | `replacedNote` |
| `system` | `Not said, waiting for the answer: "..."` | `unsaidNote` |
| `system` | `Not done: book_callback. ...` - an action refused, and why | `refusedNote` |
| `system` | `Stop words heard: opted out.` or `Stop key 9 pressed: opted out.` | `stopNote` |
| `system` | `Not done: a machine answered, and the voicemail message took the call.` | `VOICEMAIL_TOOK_NOTE` (`conversation.ts`) |
| `system` | `Record of the reply (the brain)`, with `data` | `RECORD_NOTE` (`brain.ts`) - [AI-BRAIN.md](AI-BRAIN.md), "Data" |

The timeline and a call picked back up pass over every `system` note (`resume.ts`).

## Timings

Measured on the dev number - Twilio's own part of a reply. The brain's part is [AI-BRAIN.md](AI-BRAIN.md), "How fast".

| Step | Measured | How |
|---|---|---|
| Our `text` to her voice starting (`agentSpeaking` on) | 0.29 s median, 0.49 s slowest | 17 turns, both models (A02) |
| The lead's last word to her first sound, with an echo in place of the AI | 0.66-0.76 s with `nova-3`, 0.74-1.06 s with `flux` | From the calls' recordings (A02) |
| Her last line to the session's end | About 1 second after `agentSpeaking` off | A02 |
| The lead's last partial words to the final ones | 0.1-0.45 s; Twilio documents 150-250 ms | Call 119 (A33) |
| How fast she speaks | About 160-200 words a minute on short lines; people on the phone speak about 165 | A02 |

People leave about 0.2 seconds between turns, and more than about 0.8 seconds starts to feel slow - why the relay sends each sentence the moment it is whole.

## How to add an entry

1. **A setting:** add it to `RELAY_SETTINGS`; `seriTwiml`'s test in `backend/src/integrations/twilio.test.ts` holds the TwiML word for word, so it fails until updated. Hear it on the dev number before it reaches production. A row in "The settings", in the same commit.
2. **A message from Twilio:** a case in `RelayMessage` and `parseRelayMessage`, with its test in `relay-messages.test.ts`; a row in "What Twilio sends".
3. **A tone:** a row in `TONES` - speak's persona and the check read the same list (`tone.test.ts`); a row in "The tones".
4. **A note kept as a turn:** its function in `relay-messages.ts`, beside the others; a row in "The notes kept as turns".

## History

- 2026-11-27 · Written from `AI-AGENT.md` section 1 - "What the first test calls showed", "The settings A13 starts from", "Checked on Twilio's ConversationRelay docs", "Her voice and tone" - and section 2's "What Twilio does" · one reference for what the relay and Twilio say, the settings block brought to today's `RELAY_SETTINGS` (it still showed Rachel) · D41
- 2026-11-18 · `eotThreshold="0.6"`, kept after call 119 · Flux sends the lead's words sooner · A33
- 2026-11-17 · `partialPrompts="true"` · a head start for the understand step · A33
- 2026-11-13 · Aria in place of Rachel (`21m00Tcm4TlvDq8ikWAM-v4-0.4_0.8`), and her tone written in the text; `[warmly]` and `[sympathetic, softly]` dropped from the first list after call 90 · Rachel did not sound like a real woman on calls 86-88 · A21
- 2026-11-13 · `applicationReconnect` checked in Twilio's reference after the 12200 warning on call 91; the relay picks a reconnected call back up, where before it refused it and the script took the call · A21
- 2026-11-12 · The settings chosen on the dev number with a throwaway echo server, never merged: Rachel on `v4`, `flux`, `ignoreBackchannel`; the signature, Caddy, the messages and `end` confirmed · A02
- 2026-11-11 · Twilio's ConversationRelay docs read before the first call: `SessionStatus`, the signature, `<Parameter>` in `setup`, speaker events, `dtmfDetection`; whether `end` cuts her last line was undocumented (it does not) · A02
