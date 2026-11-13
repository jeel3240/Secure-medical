# AI agent on the automated call (Phase 7)

Design agreed with Jeel, 2026-11-11. The tickets are in `docs/ai-agent-tickets/` (A01-A22). Built so far: A01, the key and the switch; A03, the knowledge loader; A04, her instructions; A05, the sentence check; A06, her five actions; A07, the call-back time rules; A08, migration 022; A09, the answer test set, which chose the model (all 2026-11-11); A02, the first test calls, which picked her voice; A10-A12, the relay - Seri talking on a call, with its limits and failures; A13, an answered call connected to her when she is switched on; A14, her action carried out when her part ends, or the script when she failed; A15, the call backs she books, saved with her result; A16, those call backs at the top of the queue when due, taken by the first agent to pick the lead up; A17, the robot asking whether she can take calls before it places any; A18, voicemail while she talks - the beep decides, and her goodbye waits for Twilio's verdict; A19, her conversation under the call on the lead's timeline; A20, the end-to-end script running her calls ending each way (2026-11-12). A21, the real-phone test, under way since 2026-11-13: her voice is now Aria, with a tone line by line (section 1, "Her voice and tone"). What each built is under "As built" in its section, and in its ticket.

Today the automated call (`docs/AUTO-CALLS.md`) is a fixed script: it understands "yes", "no", "stop" and the keys 1, 2 and 9, and anything else is asked once more before the call ends. On day one (250 calls), 82 leads hung up and 65 ended as `no_response`.

Phase 7 puts an AI agent, **Seri from eDrugstore**, on the call **from the start**. She talks like a salesperson: opens the call, gives the offer, answers questions, handles objections, and steers every call to one outcome - a person now, a call back at a time the lead picks, the link, or a polite goodbye. Everything after that outcome (transfer, hold line, link text, opt-out, voicemail) is the code that runs today.

---

## The seven decisions

| # | Decision | Section |
|---|---|---|
| 1 | Twilio ConversationRelay with an OpenAI text model and an ElevenLabs voice, not OpenAI's voice-to-voice | 1 |
| 2 | The AI runs the whole call from the start. Today's script stays only as the backup | 2 |
| 3 | Seri follows a sales playbook, knows on every turn whether anyone can take the call, and ends every call with one of five actions | 3 |
| 4 | Seri can book a call back at a time the lead picks; it reaches agents when due | 4 |
| 5 | What Seri knows is three JSON files in `backend/src/ai/knowledge/`, not database tables | 5 |
| 6 | 3-minute limit; OpenAI checked before calling; any failure falls back to the script | 6 |
| 7 | Tested on the dev number, deployed off, then switched on for every call with a server command | 7 |

---

## 1. How Seri talks on the call

```
Lead speaks
   → Twilio turns speech into text (Deepgram)
   → our server (WebSocket) → OpenAI writes the reply as text, streamed
   → our server checks each sentence
   → Twilio speaks it (ElevenLabs voice)
   → the lead hears Seri
```

Twilio `<Connect><ConversationRelay>` does the listening and speaking. OpenAI only does the thinking, in text. Our server sits in the middle and sees every word both ways.

### Why this and not OpenAI Realtime (voice to voice)

Decided by Jeel, 2026-11-11, after comparing published tests:

| | ConversationRelay + OpenAI text | OpenAI Realtime |
|---|---|---|
| Speed on real phone calls | About 1 second. Twilio's own test: 0.5 s typical | About 1 second. Faster in the lab, but one independent test of real agents measured 1.6 s on average |
| Lead talks over Seri | Built in. Twilio tells us exactly which words the lead heard before cutting in | Built in, but developers report it stops on "hmm" and "okay", and struggles in the first seconds of a call |
| Checking each sentence before it is said (no prices, no medical advice) | Yes | Not really: it relies on instructions |
| Fits today's code | The session ends into a normal TwiML `action` URL, so transfer, hold and link are reused as they are | Needs the call redirected out of a raw audio stream |

### What makes it sound human

| Setting | What it does |
|---|---|
| ElevenLabs voice (`ttsProvider="ElevenLabs"`) | One of the most natural voices: **Aria, on ElevenLabs's newest model** (`9BWtsMINqrJLrRacOk9x-v4-0.4_0.8`), picked by Jeel on A21's real calls over A02's Rachel, and given a tone line by line - "Her voice and tone", below. Provided by Twilio: no ElevenLabs account. It exists only inside the ConversationRelay session - a TwiML `<Say>` cannot use it - so Seri says her own last line before the session ends (section 3) |
| `welcomeGreeting` | The opening ("Hi, is this John?") is said by Twilio the moment the lead picks up, with no wait on OpenAI - the second in which most of the 82 hung up |
| `interruptible="speech"` | Seri keeps listening while she talks, and stops the moment the lead speaks. The part she never said is cut from the AI's history |
| Deepgram end-of-turn detection, `speechModel="flux"` | Seri replies when the lead has finished a thought, not at the first pause - Deepgram's default model, `nova-3`, took a pause mid-sentence for the end (A02) |
| `ignoreBackchannel="true"` | "Uh huh" and "okay" while Seri talks do not stop her (A02) |
| Streaming, short replies | Seri starts speaking on the first words OpenAI writes; replies are 1 to 2 sentences |

**Her words, not only her voice** (Jeel, 2026-11-12). A natural voice still sounds like a machine reading when the words are written rather than spoken. Read against ElevenLabs' prompting guide for voice agents and Twilio's ConversationRelay best practices, Seri's style already had short replies, acknowledging first, and "Sure", "Got it"; four lines were added to `style` in `sales-playbook.json` (version `approved-2026-11-12`):

- contractions - "I'm", "you're", "that's" - never stiff, written-out sentences;
- vary the words: never two replies in a row starting the same way, nor the same "Got it" every time;
- now and then, not every reply, a small first word - "So", "Oh", "Actually" - and never "um" or "uh": the guides warn that many fillers make an agent sound unsure;
- match the moment: warm about the offer; calm, unhurried and sorry first with someone upset or confused; brief with someone busy.

The answer test set, old and new side by side in the same hour, three runs each: 198 and 199 of 201 - nothing lost. With an upset caller her replies vary more and apologise more often; the relay had to say her last line for her 17 times, against 31. Contractions barely changed: she already used them. How she sounds on a real phone is A21's to judge.

Twilio provides Deepgram too, so the only accounts needed are Twilio (have it) and OpenAI (key from the client, 2026-11-09).

### Her voice and tone, from A21's real calls (2026-11-13)

On the first real calls (A21, calls 86-88), Rachel did not sound like a real woman to Jeel. Found and changed the same day, on branch `feat/seri-voice-aria-tone`:

- **The voice: Aria** (`9BWtsMINqrJLrRacOk9x-v4-0.4_0.8`, `RELAY_SETTINGS` in `ai/relay-messages.ts`). A throwaway server, as in A02 and never merged, rang Jeel's phone from the dev number with a key menu: Rachel as today, Jessica, Sarah, Laura, Aria and Matilda on `v4`, Rachel livelier (stability 0.25), and Rachel on `v3_conversational`, each saying her real greeting, opening and close. Jeel picked Aria. `v3_conversational` did not play at all - Twilio error 64112, "Error converting tokens to speech".
- **Her tone, line by line.** ElevenLabs's `v4` takes a direction in square brackets inside the text - "[understanding] No problem." - and says what follows that way; the brackets are not said ([Twilio's voice configuration](https://www.twilio.com/docs/voice/conversationrelay/voice-configuration): no fixed list; an unknown one may be said aloud; lower stability follows them more freely). The same server played Aria plain, with tones, and with tones at stability 0.25: Jeel picked tones at 0.4, today's steadiness.
- **How it is built** - `ai/tone.ts`, pure. Seven tones, one list for her instructions and the check: `[friendly]` hello, thanks and goodbye; `[friendly, upbeat]` who she is and the offer; `[curious]` a question; `[cheerfully]` good news; `[understanding]` busy, unsure or not interested; `[reassuring, calm]` worried, suspicious, upset, or an emergency; `[apologetic]` the wrong person or our mistake. Her instructions have a "How you sound" part: begin every reply with the tone that fits, another only where the feeling changes, these only. Each sentence goes to Twilio through `withTone` - tones on the list kept, written one way, up to three words of them; every other bracket dropped, a made-up tone or the who-is-there note read back - and its words alone (`spokenWords`) are what the sentence check reads and what is kept in `call_ai_turns`, so the timeline and the record show words, never tones. OpenAI reads back what it wrote, tones and all, and the greeting as Twilio was sent it (`[friendly] Hi, is this John?`, `greetingWithTone`): she keeps to tones she sees herself use - told to begin every reply with one but shown plain lines before, she gave 6 replies in 67 a tone; shown toned ones, 127 in 136.
- **Businesslike.** On call 90, "No worries, Jeel" and "just let me know when you're ready, Jeel" sounded personal - breathy - to Jeel: the first list had `[warmly]` and `[sympathetic, softly]`. Both are gone; her instructions say she sounds like a professional on a work call, never flirty, breathy or intimate; and the playbook (`approved-2026-11-13`) drops "No worries" and "when you're ready" from its examples and says never "no worries", "when you're ready", "take your time" or "I'm here for you", nor the lead's name in a line of sympathy. The answer test set fails any reply with those words.
- **What she opens with.** Her opening no longer says "You signed up on one of our partner sites" - Jeel, after call 89 - nor does the answer to "Who is this?" (`why_calling`, now "This is Seri from eDrugstore. I'm calling about our offer of up to 25% off your first order."). She says it only when asked how we got their number (`how_got_number`).
- **Her first reply is always the opening** (call 91). With nobody free - Jeel's browser was not open - a plain "Yes" to "Hi, is this Jeel?" got "Would you like to talk with someone to place your order now, or would a call back at a better time work for you?": the "Yes" taken as interest, and the who-is-there note acted on before she had asked whether he was interested. In the answer test set a plain "Yes" did the same 6 times in 15, with someone free as well as nobody; "Yes, speaking" never did. Her instructions now say the first answer is to the greeting, not the offer - "Yes" only means it is them - so her first reply is always who she is, the offer and whether they're interested, whoever is there; and the who-is-there note matters once they want to talk to someone, never in the opening. Three cases on the lead's first answer (`opened: false`) - `opening_free`, `opening_nobody`, `opening_coming` - passed 9 of 15 before, 30 of 30 after; the whole set 141 of 142, two runs each, the one miss `no_once` - the link sent while asking why, still open (A21). After the opening, with nobody free, she still offered "connect you now" (call 92) - section 4, "Changed after A21's call 92".
- **Not offering to connect twice in a row.** On call 90, seven of her nine replies ended "Would you like me to connect you with someone now?", and Jeel asked her why. Her instructions say not to, and the closing questions are "only in the situation named"; she did all the same about half the time. So after a reply that offered (`offeredToConnect`, `ai/conversation.ts`), the lead's next turn carries a system note: you already offered; a yes goes ahead, otherwise don't offer again - ask if there's anything else they'd like to know (`NO_REPEAT_NOTE`, `leadTurn`; the answer test set builds turns the same way). A new case, `no_repeat_connect`, fails on "connect", "talk to someone" and the like.
- **An action written instead of taken.** With brackets in her words, she now and then wrote her action in them too - `[send_link]`, `[functions.opt_out()]` - and once only wrote it: "I'll book that call back for tomorrow at 2 PM" with `[functions.book_callback:{...}]` and no booking. Her instructions say brackets are for tones only; and when a reply has no action but one written in brackets (`writtenAction`, `ai/actions.ts`), the relay takes it as if she had, through the same checks, and logs `ai_relay.written_action`. The bracket is never said.
- **The answer test set, `dev` and the branch side by side** (two runs each): `dev` 133 of 134, the branch 132 of 136, a tone in 127 replies, first word 0.57 s median. The branch's misses: a call back booked too soon (refused by the check, as on a call); the Saturday case - which fails on `dev` too, 3 of 5 runs against 2 of 5 here; and a reply that opted the lead out, then said her greeting again - the question at its end held the stop back, so a stop is now never held back (section 3, "Two rules"). The who-is-there note read back still happens now and then; it is dropped before the voice.
- **Not covered.** Which tone a line had is not kept: `call_ai_turns` holds her words, and the logs never hold words. Twilio warns a tone can be said aloud or add breathy sounds; none was heard on the test calls, and only tones on the list reach the voice.

**The model: `gpt-4.1-mini`** (`backend/src/ai/model.ts`), chosen by the answer test set (A09, 2026-11-11): 133 of 134 cases passed (99.3%), and Seri's first word came 0.55 s after the request (median), 90% within 0.68 s, measured from a laptop. Next best: `gpt-5.4-mini` with reasoning off, 94.8% at the same speed; `gpt-5-mini` 85.8% and slower; `gpt-4o-mini` 79.9%. The smaller models' commonest fault was saying goodbye without taking the action. The instructions' shared first part is sent with a cache key and was read from OpenAI's cache 87-95% of the time.

**Checked on Twilio's ConversationRelay docs, 2026-11-11** (what later tickets rely on):

- When `<Connect>` ends, Twilio requests its `action` URL with `SessionStatus`: `ended` (we ended it, with our `HandoffData`), `failed` (with `ErrorCode`), or `completed` (the caller hung up).
- The WebSocket request carries Twilio's signature (`X-Twilio-Signature`), as every webhook does. `<Parameter>`s inside `<ConversationRelay>` arrive in the `setup` message under `customParameters`. Both confirmed, and which address is signed, below.
- `events="speaker-events"` sends `agentSpeaking` and `clientSpeaking` messages - how the server knows when Seri has stopped talking. Their shape is below.
- `dtmfDetection="true"` sends key presses over the WebSocket.
- **Not documented:** whether `end` waits for Seri's last words to be heard or cuts them off. It waits - below.
- **Before the first call:** the Twilio account must complete ConversationRelay's onboarding in the console, which includes accepting Twilio's AI features addendum. Until then a `<ConversationRelay>` call fails. Done before A02's calls.

### What the first test calls showed (A02, 2026-11-11 and 12)

A throwaway server answered the dev number, (480) 530-8582, with `<ConversationRelay>` and said back what it heard - no OpenAI. It was never merged; only these findings are kept. Calls from Jeel's phone, and from the dev number calling itself, recorded on both sides so the gaps could be measured in the audio.

**The voice: Rachel, on ElevenLabs's `v4` model** *(replaced by Aria on A21's real calls, 2026-11-13 - "Her voice and tone", above)* - `21m00Tcm4TlvDq8ikWAM-v4-0.4_0.8`, picked by Jeel, 2026-11-12, from four voices (Rachel, Jessica, Matilda, Sarah) saying the same lines. The string is the voice id, the model, then stability 0.4 and similarity 0.8 - a little livelier than the default, still the same voice. With no model named, Twilio uses ElevenLabs's oldest English model, `flash_v2`, which Jeel found less human. With `v4` (and `v3`) the speed must be left out or be 1.0. She speaks about 160-200 words a minute on short lines; people on the phone speak about 165.

**How fast:**

| Step | Measured |
|---|---|
| Our `text` message → Seri's voice starts (`agentSpeaking` on) | 0.29 s median, 0.49 s slowest - 17 turns, both models |
| The lead's last word → Seri's first sound, with an echo instead of the AI (from the recordings) | 0.66-0.76 s with `nova-3`, 0.74-1.06 s with `flux` |
| The same with OpenAI's first word added (0.55 s on 2026-11-11, 0.92 s on 2026-11-12) | About 1.3-1.9 s expected; A11 measures it on every turn (`call_ai_turns.latency_ms`) |

People leave about 0.2 s between turns, and more than about 0.8 s starts to feel slow, so the relay saves time where it can: OpenAI's words streamed, the first sentence sent the moment it is whole, a short first sentence (A11).

**Listening:**

- `nova-3`, Deepgram's default, took a short pause mid-sentence for the end of the turn and sent the two halves as two prompts - Seri would answer half a sentence. `flux` waited for the whole thought, a little slower (above).
- `ignoreBackchannel="true"`: "uh huh" and "okay" said while Seri talked did not stop her. Speaking did, at once.
- The greeting can be talked over (the default, `welcomeGreetingInterruptible="any"`), like every other line.

**The settings A13 starts from** - heard together on the dev number (the voice Aria since A21, `9BWtsMINqrJLrRacOk9x-v4-0.4_0.8`):

```
ttsProvider="ElevenLabs" voice="21m00Tcm4TlvDq8ikWAM-v4-0.4_0.8"
transcriptionProvider="Deepgram" speechModel="flux"
interruptible="speech" interruptSensitivity="low" ignoreBackchannel="true"
elevenlabsTextNormalization="on" dtmfDetection="true" events="speaker-events"
applicationReconnect="true"
```

*As built (A13):* these, word for word, are `RELAY_SETTINGS` in `backend/src/ai/relay-messages.ts`, which every call to her uses (section 2).

`interruptSensitivity="low"` asks for clear speech before she stops; `elevenlabsTextNormalization="on"` reads numbers and short forms as words; `applicationReconnect="true"` has Twilio try again if our WebSocket drops - for a deploy mid-call. On every A21 call Twilio logged a warning (12200) that the attribute is not allowed on `<ConversationRelay>` - but it is in Twilio's ConversationRelay reference (checked 2026-11-13: when `true`, Twilio buffers what happens while the socket is down and replays it once reconnected; `false`, the default, ends the call `failed`), so the warning is Twilio's XML check not knowing it yet. Handled since 2026-11-13 and heard on a real call - a reconnect picks the call back up (section 2, "When the line drops"); before, the relay took a call once (`startAiCall`) and refused it, Twilio posted `failed` and the script took the call. The other two were not tested on their own.

**Confirmed** - what the relay is built on:

- **The signature.** The WebSocket request carries `X-Twilio-Signature`, signed for the `wss://` address exactly as written in the TwiML, query string included, with no parameters (`{}`). The same address with `https://`, or without its query, does not match. A10 checks it that way.
- **Caddy.** Production's rule, `handle /api/* { reverse_proxy api:3000 }`, passes the WebSocket as it is: the calls went through Caddy 2 with that rule, behind the tunnel. Nothing to change.
- **The messages**, as they arrived:
  - `setup`: `sessionId`, `callSid`, `parentCallSid`, `from`, `to`, `forwardedFrom`, `callerName`, `direction`, `callType` (`PSTN`), `callStatus` (`IN_PROGRESS`), `accountSid`, and `customParameters` - each `<Parameter>` by name.
  - The lead: `{ "type": "prompt", "voicePrompt": "How can you help me?", "lang": "en-US", "last": true }` (`lang` is `en` with `flux`).
  - Speaker events: `{ "type": "info", "name": "agentSpeaking", "value": "on" }` - `clientSpeaking` the same way, `off` when it stops.
  - Talking over her: `{ "type": "interrupt", "utteranceUntilInterrupt": "...what she had said...", "durationUntilInterruptMs": 8636 }`.
  - A key: `{ "type": "dtmf", "digit": "1" }`.
- **`end` never cuts her last line short.** A 13-second line with `end` sent straight after it was heard to the last word. Twilio ends the session about a second after `agentSpeaking` off, then posts the `action` URL with `SessionStatus=ended` and our `HandoffData`. So the relay sends `end` straight after her last line, with no wait (A11) - since A18, after a goodbye, the link or a call back only once Twilio's verdict on who answered is in, up to 15 seconds (section 2).
- **The lead hanging up:** `SessionStatus=completed`, `CallStatus=completed`, no `HandoffData`.
- **Our WebSocket dropping mid-call** (the test server restarted): Twilio logged error 64105 and requested the `action` URL - the backup path in section 6 (A12).

### How a reply is made (A11, as built 2026-11-12)

`backend/src/ai/conversation.ts`, one per call, behind the relay (section 9); OpenAI through `ai/openai.ts`, asked exactly as the answer test set asks - her model, the five actions as tools, one at most, the shared prompt cached, no retries.

- **At the start:** her instructions are built for the call (A04) - the lead's first name and number, the agents' hours (`readCallHours`), our number (`TWILIO_PHONE_NUMBER`), the script's stop line. OpenAI's history starts with them and the greeting Twilio said, with its tone (A21). No active script: the session is closed as a failure before she starts (`ai_relay.no_script`).
- **Each thing the lead says:** first **the stop check**, then who is there now (`whoIsThere` - `freePeople`, then `someoneOnOrJustOffCall`, the transfer's own rules), then OpenAI with the whole call; the lead's turn is `leadMessage` - the note of who is there, then their words - the same function the answer test set uses (`evals/grade.ts`). A failure to read who is there counts as nobody, so she never promises a transfer.
- **Her reply, a sentence at a time:** OpenAI's words are cut into sentences as they arrive (`ai/sentences.ts` - "Dr." and "3 p.m." end none); each is checked (A05) and sent the moment it is whole, as a `text` with `last` false, and the reply closed with an empty `last` true. A replaced sentence - the specialist line said in its place - is the last of that reply; any action in it waits, since the specialist line asks a question; the sentence and why are kept as a `system` turn.
- **Her action:** checked as the test set checks it (`toHandoff`, with who is there for this turn). Taken: the last line the relay adds when she gave none (`lineToAdd`), the reply closed, then `end` with the action as `handoffData` straight after - Twilio says the whole line first (A02) - and `calls.ai_ended_with` with `ai_agent.ended` recorded together, once. *(Since A18 a goodbye, the link or a call back keeps her choice at once but sends `end` and records her part only once Twilio's verdict is in - section 2.)* Refused: she is told why, as the tool's answer in her history, and speaks again at once - or waits for the lead when her reply asked a question (`awaitLead`); after two refusals in a row she waits for the lead.
- **Talked over:** her reply stops at once (the OpenAI request is aborted) and nothing more of it is sent; the history keeps only what Twilio says the lead heard (`utteranceUntilInterrupt`) - the reply still being written, or the last one already sent, or the greeting. Nothing heard: the history is left as it was.
- **The lead says more before she answers:** what she was writing is dropped and one reply answers all of it; what she had already said stands in the history.
- **The stop check** (`saysStop`, `core/answers.ts`): the script's stop words, read for a conversation - a phrase ("stop calling", "remove me", "don't call") anywhere in what the lead said, a single word ("stop", "unsubscribe") only said on its own ("Stop.", "No, stop", "Stop it, please"). So "Do I need to stop my other medicine?" is hers to answer, not an opt-out that blocks the number; she catches every other way of asking herself. Key 9 is a stop too. Either way, at once and without OpenAI: the script's stop line, then `end` as `opt_out`.
- **Kept as turns:** her greeting; each lead turn and key; each of her replies as said - her words, without her tones (A21) - with `latency_ms` - from the lead's words reaching us to her first sentence going out; a sentence replaced, an action refused, a stop heard (`system`); and her action as its `handoffData` (`action`). Since A12 also the relay's own lines, as hers: "One moment...", "Hello, are you still there?" and the goodbye when the relay ends the call. Never in the logs: each reply logs only its times, how many sentences, whether one was replaced, whether the filler was said, and the action (`ai_relay.reply`).
- **Limits and failures** - silence, the three minutes, OpenAI slow or failing, the socket or the relay failing: section 6, "As built (A12)".

**How fast, measured** (2026-11-12, the real API on a scratch database, a fake Twilio client, the real OpenAI, from a laptop): from the lead's words reaching us to her first sentence going out, 0.66-0.90 s - OpenAI's first word 0.54-0.85 s of it, the first sentence being written whole only 0.03-0.11 s more. A first run the same hour took 1.19-1.75 s, all of it OpenAI's: its speed changes from minute to minute. A stop: 1 ms. On a call Twilio's own part comes on top - about 0.3 s to start her voice, and Deepgram deciding the lead has finished (A02, above).

---

## 2. The AI runs the whole call

Decided by Jeel, 2026-11-11, reversing the earlier "keep the script, hand off when off-script" (2026-11-04):

- The hybrid could not help the **82 who hung up** - most did so during the robotic opening, before saying anything.
- The script's Kore voice and Seri's ElevenLabs voice would change mid-call.
- The client had asked for it ("run from start", 2026-11-05).

### What changes, what stays

| | With the AI on |
|---|---|
| Lead picks up | `/auto/answer` connects the call to Seri (`<Connect action="/auto/ai-after"><ConversationRelay welcomeGreeting="Hi, is this John?"/></Connect>`) instead of asking the script's Q1 |
| Voicemail | **Unchanged.** Twilio's machine detection runs as today; a beep replaces the call with the voicemail message (`onVerdict`, T18). Until the verdict has come, a goodbye, the link or a call back waits - up to 15 seconds (A18) - so a greeting such as "he's not available" is not taken for the lead saying no; a transfer and a stop do not wait. *As built (A18):* below |
| "Stop" | Seri's `opt_out` action - and a check of every lead turn, independent of the AI: the script's stop words (`call_scripts.opt_out_words`) or key 9 end the session as an opt-out even if the AI misses it. *As built (A11):* a stop phrase counts anywhere in what the lead said, a one-word stop word ("stop") only said on its own - section 1, "How a reply is made" |
| Transfer, hold line, busy line, link text | **Unchanged.** Seri's action ends the session, and `/auto/ai-after` runs today's code |
| Today's script | Kept, only as the backup (section 6) |

### As built (A13, 2026-11-12)

`/auto/answer` (`backend/src/api/twilio-webhooks.ts`), once it knows the request names our call and the script is there:

- **Who takes the call** - `seriGreeting` (`backend/src/ai/answer.ts`): the switch and the key, read on every call (`readAiAgentOn`, section 7). On: the call goes to Seri. Off, never set, or on without `OPENAI_API_KEY`: today's first question, exactly as before; on without a key also logs `ai_agent.no_key`, once.
- **The script is read first**, for her too: it is her backup (A14) and holds the stop line she says. No script: the call ends quietly, as before. The switch unreadable - the database failing - ends it quietly too, as any failure there does.
- **What Twilio is told** - `seriTwiml` (`backend/src/integrations/twilio.ts`), in place of the script's first question:

  ```xml
  <Connect action="https://<our address>/api/webhooks/twilio/auto/ai-after?call=42" method="POST">
    <ConversationRelay url="wss://<our address>/api/ai/relay" welcomeGreeting="Hi, is this Dana?"
        ...section 1's settings...>
      <Parameter name="call" value="42"/>
    </ConversationRelay>
  </Connect>
  ```

  The settings are section 1's, written as A02's test calls wrote them (`ignoreBackchannel`, not the library's `ignorebackchannel`). The greeting is "Hi, is this Dana?" with the lead's first name, "Hi there!" without one; the relay builds the same from the same name as her first turn (`welcomeGreeting`, A04). The relay's address carries nothing: Twilio signs it as written and the relay checks it so (A10); our row travels in the `<Parameter>`, which arrives in `setup`.
- **No second of quiet first**, unlike the script: Twilio says the greeting as soon as the relay is connected. Whether a first word is lost to a phone still coming to the ear is for A21 to listen for.
- **Voicemail detection unchanged:** the call is placed exactly as before (`automatedCallRequest`). Acting on a verdict while she talks is A18.
- **Logged:** `auto_call.answered` with `to` - `seri` or `script` (`LOGGING.md`).
- **Tested:** the TwiML word for word (`integrations/twilio.test.ts`); the route switched on with a name and without, off and never set, on without a key over two calls, with no script, with the switch unreadable (`auto-call-webhooks.test.ts`); `seriGreeting` on a real Postgres (`scripts/ai-agent-live-check.ts`, 72 checks).
- **Seen on the real API** (2026-11-12, a scratch database, requests signed as Twilio signs them): with the switch on, `/auto/answer` replied with the TwiML above, "Hi, is this Dana?"; a client connecting to the relay exactly as that TwiML said - its address, signed for it, the `call` parameter in `setup` - started her on that call (`ai_started_at`, `ai_agent.started`, the greeting her first turn); switched off with the command while the API ran, the next call got the script with no restart; on with no key, the script on two calls and `ai_agent.no_key` logged once; a lead with no first name, "Hi there!".
- **Where her part ends:** `/auto/ai-after`, built in A14 - section 3, "As built (A14)".
- **The text questions stop once the lead has talked to her** (rule 2d, `STATE-MACHINE.md`; added 2026-11-13, found in the doc check after A20): anything the lead said or pressed to her counts as answering the call, as a choice does on the script, so a "thanks" to the link she texted goes to a person instead of getting Q1's "Sorry, please reply 1 or 2". Not when the voicemail message took her call (`phoneTookOverAtSql`, `db/lead-state.ts`; `agent-sms-live-check`).

### As built (A18, 2026-11-12) - voicemail while she talks

- **The beep decides, as on the script** (`actOnVerdict`, `db/auto-calls.ts`; `AUTO-CALLS.md`, "Voicemail"): anything the lead said to her (`call_ai_turns`, `who = 'lead'`) counts as an answer, and a key pressed while she talked (`(pressed 1)`, `KEY_TURN_PREFIX`) as a key. So a beep after the greeting she heard leaves the voicemail message; a machine with no beep after words she heard carries on, as call 24 taught; a key means a person, whatever Twilio says; nothing said, a machine gets the message.
- **Her ending actions wait for the verdict** (`ai/conversation.ts`): a goodbye (`end_call`, the relay's own included), the link and a call back. Her last line is said and her choice kept at once - a lead who hangs up in the wait still gets the link, as the action URL reads it (A14) - but how her part ended is recorded, and `end` sent, only once Twilio's verdict has come (`calls.answered_by`, asked every half second - `verdictState`, `ai/relay-store.ts`), or after 15 seconds without one (`VERDICT_WAIT_MS`). On the real calls Twilio decided a person 3.4 to 6.6 seconds in, so a person seldom waits; a machine's verdict comes when its greeting ends.
- **The beep in the wait:** the voicemail message has taken the call - she ends nothing, records nothing, and a note says why (`Not done: a machine answered, and the voicemail message took the call.`). The session's end that Twilio may still post is ignored (`after_takeover`, A14).
- **A transfer and a stop do not wait:** a transfer to a machine is stopped by its beep as on the script, and a stop is honoured at once. A fallback does not wait either: the script takes the call, under the same rule.
- **A hang-up** while she talks: `/auto/ai-after` with `completed` - what she had ended with, or nothing and `hung_up` (A14); the relay closes with the socket (`ai_relay.closed`, `ended` false).
- **Logged:** `ai_relay.verdict_wait` - how long it waited (`waitedMs`), and what came: `in`, `taken`, or `none`.
- **Tested:** the wait in the conversation - not ended until the verdict, a person, the beep, none in 15 seconds, the socket closing, the link waiting, a transfer and a stop not, the verdict unreadable (8); through the relay's WebSocket - early, late, never, the beep (4); on a real Postgres, the rule with her turns - silence, words, the beep after words, a key - and the verdict reader (`ai-agent-live-check`, 116).
- **Seen on the real API** (a scratch database, a pretend Twilio): silence, "are you still there?", her goodbye at 12.5 seconds - then nothing until Twilio's verdict was posted 3 seconds later, and the end 20 milliseconds after it, recorded as `end_call`.

---

### When the line drops - the api restarting (2026-11-13, after A21's call 91)

Seri's call runs over a WebSocket between Twilio and our api. A deploy restarts the api, which cut that line: Twilio tried to reconnect (`applicationReconnect`, on since A13), the relay refused - it took a call once - and the lead heard "Sorry about that." and the script from its first question, or Twilio's application error if the api was still down when Twilio asked `/auto/ai-after`. Found while looking into Twilio's warning on call 91; Jeel: fix it.

**What Twilio does** ([its reference](https://www.twilio.com/docs/voice/conversationrelay/best-practices#handling-connection-drops), read 2026-11-13): the line closing with 1001, 1006, 1011, 1012 or 1013, or no answer to its pings for 45 seconds, starts a reconnect - up to 3 tries, 0.5 then 1 second apart, 3 seconds each, and at most 5 reconnects a call. Meanwhile it keeps the call and holds up to 500 events (10 seconds) of what the lead says, and replays them after the new `setup`, which says `connectionType: "reconnect"` and `reconnectAttempt`. A 4xx answer other than 408 or 429 stops it; any other close code of ours ends the call. All tries failing ends the call `failed` - the action URL, and the script, as before.

**As built:**

- **Picking the call back up** - `relay.ts`. A `setup` that says `reconnect` (`parseRelayMessage`) asks `resumeAiCall` (`relay-store.ts`) for the call: the same Twilio call, hers, not over - with its row locked, every turn kept so far, and `ai_agent.reconnected` recorded (`callId`, `attempt`, `ended`), in one transaction. Then `earlierConversation` (`resume.ts`, pure) rebuilds what OpenAI read on the call from the turns - her greeting left out, the lead's words with who is there now, her lines, "One moment..." and keys left out as on the call, a reply talked over cut to what was heard, a refused action's note, and the note against offering to connect twice - and the conversation goes on from there (`Conversation`, `earlier`): no greeting again, the three minutes counted from when she took the call, and what the lead said after her last reply answered at once. A `system` turn marks the place: "Reconnected: the line to our server dropped, and the call was picked back up (attempt 2)."
- **Her action already chosen** before the line dropped - an `action` turn kept - is carried out: `end` sent again with it, `ai_ended_with` recorded once; OpenAI is not asked.
- **A call she never took** - the line dropped before her first connection got that far: she takes it from her greeting, as on a first connection. A reconnect for a call that is over, or another Twilio call's, is refused (1008), as before; a first `setup` for a call already hers still is.
- **One line per call.** A reconnect while this api still holds the old line - the network dropped, not the api - cuts that one first and waits for its turns to be written: they are the call so far. A reconnect naming another Twilio call never cuts one.
- **Stopping the api** - `api/index.ts`, on Docker's SIGTERM (it reaches node through `npm run api`; measured locally, stopped in 0.14 s): no new connections, then each call's line closed with 1012, "Service Restart", once its turns are written (`Relay.stop`, two seconds at most); a relay connection that arrives meanwhile gets 503, which Twilio tries again. What the lead says as the line closes is still kept, and answered after the reconnect. Then the requests under way finish, two seconds at most. Logged `api.stopping`, with how many calls were with her.
- **Caddy waits for the api** (`Caddyfile`, `lb_try_duration 10s`): recreating the api took it down 3.3-3.4 seconds locally, and Twilio's three tries can all fail within two seconds if each is answered 502 at once. Held at Caddy instead, a try waits up to its 3 seconds for the api to come back, so the three cover about ten seconds. It holds every request to `/api` the same way - Twilio's webhooks during a deploy too; a request the api was already answering when it stopped is not tried again. Locally, 60 requests through a Caddy set up the same way while the api was recreated: all 200, the one in the gap 3.03 seconds.

**Tested:** `resume.test.ts` (10), the conversation picked up (`conversation.test.ts`, 5), the relay - picked up, answering at once, an action carried out, never started, refused, one line per call, a reconnect for another call, stopping (`relay.test.ts`, 11 new), reading `connectionType` (`relay-messages.test.ts`); 1,690 backend tests in all; `resumeAiCall` on a real Postgres (`ai-agent-live-check`, 17 new, 133 in all); and `npm run e2e` step 20 - Ivy's call through the real relay, the api stopped mid-call (1012), a fresh relay with nothing in memory taking Twilio's reconnect, OpenAI asked with the call so far, one start, one reconnect, one end, one conversation on the timeline (141 checks).

**Heard on a real call** (call 92, 2026-11-13, the dev number to Jeel's phone, through a local Caddy set up as production's): the api recreated four seconds after her second reply; back 3.3 seconds later; Twilio's second try reconnected; the "Yes." Jeel said meanwhile was replayed and answered 1.3 seconds later, with no second greeting; one `ai_agent.started`, one `ai_agent.reconnected` (attempt 2), one `ai_agent.ended`.

**Not covered:** Caddy itself restarting - a deploy that rebuilds the frontend recreates it, and its line to Twilio drops with nothing holding the reconnect; it starts in about a second, inside Twilio's first two tries, but this is untested. A reply she was in the middle of when the line dropped is not kept: after the reconnect she answers the lead's words again, and the lead may hear its start twice. What Twilio plays during the gap - silence, as far as call 92 told.

## 3. The sales playbook and Seri's five actions

### How a call goes

| Stage | What Seri does |
|---|---|
| Opening | "Hi, is this John?" (lead's first name; "Hi there" without one), said as the `welcomeGreeting`. Then who she is and the offer: up to 25% off the first order |
| **Yes** | Asks **when** they want to talk to someone. "Now" → a person, if anyone is there (below). "Tomorrow at 3" → book a call back |
| **No** | Asks why, once, like a salesperson. Offers the other products (STI treatments, test kits), then the link. After **two clear no's**, thanks them and ends |
| A question | Answers from the approved answers, then back to the offer |
| **Doesn't know the answer** | **Never** "I don't know" or "I can't answer that." Says "That's a great question. Let me connect you with one of our specialists who can help with that," then transfers - or, with nobody there, books a call back |
| Medical question, upset caller | Same: a specialist now, or a call back (the client, 2026-11-05) |
| "Stop calling me" | Opt out, every time |

How she talks, the nine objections and what she never does are in `backend/src/ai/knowledge/sales-playbook.json` (section 5).

### Who is there - told to Seri on every turn

Decided by Jeel, 2026-11-11. Before each reply the server works out who could take the call now, with the same rules the transfer and the hold line use (`FREE_SQL`; who is coming, T17), and tells Seri:

| The server sees | Seri |
|---|---|
| **Someone free** | Offers a person now → `transfer_to_agent` → the lead's own agent first, then everyone free (T15) |
| **Nobody free, but someone coming** - on a call, writing its note, or ringing with another lead | `transfer_to_agent` all the same → the hold line, as today (T16, T17) |
| **Nobody at all** | No transfer. Offers a call back time instead → `book_callback`, in place of today's busy line. *Since A21's call 92:* never "connect you now?" - she says everyone is busy and asks when would be a good time; a "yes" to an offer she made anyway gets the note to ask when, not to go ahead (`NO_REPEAT_NOBODY_NOTE`, below). *Since call 93:* every lead turn while nobody is there carries a note not to offer a person now (`NOBODY_NOTE`, section 4) |

If it changes between her words and the transfer, the transfer's own rules decide, as today: the hold line, or the busy line and **Wants a call** in the queue (T22).

"Ringing with another lead" includes her own transfers (2026-11-13, found in the doc check after A20): a call whose part ended with `transfer_to_agent` counts as ringing until it is taken, held or missed (`TRANSFER_RINGING_SQL`, `db/presence.ts`; `presence-live-check`). Before, it counted only the script's "yes", so while her transfer rang, another call's "yes" heard the busy line and she was told nobody was coming.

### The five actions

Seri ends every call by choosing exactly one. She says her last line herself, in her voice; then our server ends the ConversationRelay session with the action in `handoffData`, and Twilio posts to `/auto/ai-after`, which carries it out with today's code and says nothing more of its own - only the recording notice before a transfer, and the hold or busy line when today's transfer reaches them:

| Action | When | Seri's last line | What `/auto/ai-after` does | `script_result` |
|---|---|---|---|---|
| `transfer_to_agent` | Wants to order now, or wants a person - and someone is free or coming | "Great, connecting you now." | The recording notice, then `planTransfer`: own agent first, then everyone free, then the hold line or the busy line (T15-T17) | `transferred` / `transfer_missed` |
| `book_callback` | Wants a call later, or nobody is there | Confirms the time in the lead's own zone, says goodbye | Saves the callback (section 4), hangs up | `callback_booked` (new) |
| `send_link` | Wants to look for themselves | Says the link is on its way, says goodbye | Texts the link (T14), hangs up | `link_sent` |
| `opt_out` | Asks not to be called | The script's stop line ("Okay, we will not call you again...") | Blocks the number (T13), hangs up | `opted_out` |
| `end_call` | Not interested, wrong person, an emergency, done | Goodbye | Hangs up. The reason she gave is kept with the action | `not_interested` |

The relay itself also ends a call with `end_call`, with a reason she is never offered: `no_response` - the lead silent after "are you still there?" - and `time_limit` - the three minutes and the 20 seconds after them run out (section 6, A12).

The relay sends `end` straight after Seri's last line for a transfer, a stop or a fallback; a goodbye, the link or a call back first waits for Twilio's verdict on who answered, up to 15 seconds (A18, section 2). Either way Twilio says the whole line first and only then ends the session, so her last line is never cut off (A02, section 1).

Seri has no action for payment, personal details (date of birth, address, card) or prescriptions, so she cannot do them.

*As built (A06, 2026-11-11):* `backend/src/ai/actions.ts`. The five are OpenAI tools in strict mode: `book_callback` takes the time on the lead's own clock ("2026-11-12T15:00"), their IANA zone and a one-line reason; `end_call` a reason from a list - `not_interested`, `wrong_person`, `emergency`, `other`; the other three nothing. `toHandoff` checks a tool call against the turn's view of the call: a call back outside the hours, past, too soon or too far, and a transfer when nobody is there, come back to Seri as words saying what to offer instead ("Offer tomorrow at 1 PM your time instead, and if they agree, book it as 2026-11-12T13:00."), and the call goes on. The handoff is JSON - `{"action":"book_callback","at":"<instant>","timeZone":"America/New_York","reason":"..."}` - and `fromHandoff` reads Twilio's `HandoffData` back, keeping only what it knows: anything missing or unreadable is a `fallback`, never an error.

**Two rules the answer test set led to (A09):** the lead always hears a last line - when Seri takes an action with no words, the relay says the action's own in her voice, and an opt-out always ends with the stop line (`lineToAdd`); and an action in a reply that ended on a question is held back - the lead answers first (`toHandoff`'s `awaitLead`). *(Except an opt-out, since A21: a stop is taken at once every time - on a test run she opted a lead out, then said her greeting again, and the question held the stop back.)* *(Since A21's call 89, 2026-11-13: a question **anywhere** in the reply, not only at its end. After a "No" she asked "Is it more the timing, or just not something you need right now?", added "I can also text you a link to browse later." and texted it in the same reply - Jeel never said yes. Her instructions say too: after a no, ask why and wait for the answer before offering anything; and the link only once they asked for it or said yes to it - offering it is not sending it. A case from call 89, `no_after_scam_question`, and the whole set, 74 cases, two runs each: 145 of 148, every case that expects an action still taking it; the misses a stop at the greeting - caught by the relay's own stop check on a call, and as often on `dev` - and two brackets dropped before the voice, the who-is-there note read back and a tone with its comma missing.)*

**Not an action Seri picks:** `fallback`, which the relay ends with when she fails (section 6) - with why: `model_failed`, `model_slow`, `socket_error` or `relay_failed` (A12); and at the action URL `twilio_failed` - Twilio's side failed before the relay recorded anything - or `no_handoff`, `unreadable_handoff`, `unknown_action` when `HandoffData` cannot be read (A14). `/auto/ai-after` then asks the script's Q1 question - not its greeting, since Seri has introduced herself - and the call goes on as today.

### As built (A14, 2026-11-12)

`POST /api/webhooks/twilio/auto/ai-after?call=<row>` (`backend/src/api/twilio-webhooks.ts`), the `action` of every call's `<Connect>` (A13). Like every `/auto/*` webhook: signed by Twilio, kept in `webhook_events`, 404 while automated calls are off. What follows her part is one pure rule, `afterSeri` (`backend/src/ai/after.ts`); the route carries it out with the script's own code.

**Which action** - from Twilio's `SessionStatus`:

| Twilio says | The action carried out |
|---|---|
| `ended` - we ended the session | Hers, from `HandoffData` (`fromHandoff`); anything unreadable is a `fallback` |
| `failed` - Twilio's side, or our socket, failed | What the relay had recorded she ended with, if anything; otherwise `fallback`, recorded here as `twilio_failed` (`ai_ended_with`, `ai_agent.ended`) so the robot counts it (A17) |
| `completed` - the lead hung up | What the relay had recorded she ended with (`recordedHandoff`, her last `action` turn) - Twilio sends none. Nothing recorded: nothing is done, and the call's end saves `hung_up` |

Her action is also passed to `endAiCall` on `ended` and `failed`: recorded once, by whichever comes first, so a record the relay could not write is not lost.

**What each does** - the script's own code, and nothing said that she has said:

| Her action | The lead on the line | The lead gone |
|---|---|---|
| `transfer_to_agent` | The recording notice (on recorded calls), then the script's transfer as it is: the lead's own agent alone first, everyone free, the hold line with the notice, or the busy line and `transfer_missed` (`planYes`, `yesTwiml`, shared with `/auto/gather`). The ring shows "Transfer · said yes to the offer": her call is the offer, the script's first step (`transferContext` gives that step for a call she took) | Nobody rung; `hung_up` |
| `book_callback` | `callback_booked` and the call back saved together, hang up (A15, section 4) | The same |
| `send_link` | `link_sent`, hang up, the link texted after Twilio has its answer - once: only the request that saved the result texts | The same |
| `opt_out` | `opted_out`, the number blocked (`call_opt_out`) and the lead's open text conversation ended, as a stop on the script, hang up | The same - a stop said just before hanging up still blocks |
| `end_call` | `not_interested` whatever her reason - the reason is kept with her action - except the relay's `no_response`, which is the script's `no_response`; hang up | `not_interested`; `no_response` becomes `hung_up` |
| `fallback` | "Sorry about that." then the script's first question alone - "Are you interested in ordering?" - in the script's voice, listening as on any first asking; the answer goes to `/auto/gather` and the call carries on as today. No script: the call ends | Nothing; `hung_up` |

As on the script, as said while hanging up (`handleAnswer`): a stop still blocks, a link is still texted, a "yes" reaches nobody.

- **The result is saved once** - `keepCallResult` (`backend/src/db/auto-calls.ts`), the same transaction `keepAnswer` uses, now shared: the call locked, the result written only if it has none, a stop's block. A request Twilio sends twice saves and texts nothing the second time.
- **After the voicemail message has taken the call** (T18): nothing is done, logged `auto_call.after_takeover`, as `/auto/gather` and `/auto/after` do.
- **Logged:** `auto_call.ai_after` - the status, the action, `hungUp`, Twilio's `errorCode` on a failure, `why` for a fallback; then the transfer's own lines (`LOGGING.md`). Anything failing: `auto_call.ai_after_failed`, and the call ends quietly.
- **Tested:** `afterSeri` and `fallbackAsk`, every action with the lead on the line and gone (17, `ai/after.test.ts`); the route - each action, a transfer to people free, to the lead's own agent, on hold, the busy line and with the lead gone, the link once, the fallback from the relay, from Twilio failing and from unreadable data, a hang-up after a stop and after the link, the voicemail's takeover, a call not ours, the database failing (23, `auto-call-webhooks.test.ts`), and none of them saying a line she has said; on a real Postgres, the recorded action, the result once, the block once, the voicemail's takeover, a transfer's step (`ai-agent-live-check`, 86 checks).
- **Seen on the real API** (2026-11-12, a scratch database, a pretend Twilio): "Stop calling me." - the relay said the stop line and ended with `opt_out`, `/auto/ai-after` hung up, the number blocked, `opted_out`; "Remove me from your list." then the lead hanging up (`completed`, no `HandoffData`) - blocked all the same from the relay's record; OpenAI refusing the key - the relay's `fallback`, then "Sorry about that." and the script's question, listening on step 1; a transfer with one agent free - rung, "said yes to the offer".
- **Not covered:** a lead who hangs up before Twilio has passed their last words to the relay - "stop calling me" and the phone down at once. The relay never hears it, so nothing blocks the number; on the script Twilio still posts what was heard after a hang-up. For A21 to try on a real phone.

---

## 4. Calls back at a time the lead picks

Decided by Jeel, 2026-11-11.

| Step | What happens |
|---|---|
| Seri books it | The time and a one-line reason ("Wants to order antibiotics") |
| Who it belongs to | The lead's own agent, if one holds the lead. Otherwise **open to everyone** |
| Before it is due | The lead's page shows "Callback booked: Thu 3:00 PM" |
| When it is due | Top of the queue as **Callback · 3:00 PM**; the first agent to open the lead takes it |
| Nobody calls | Stays at the top as overdue until someone does |

**Seri's two rules when booking:**

1. **Agent hours only:** weekdays 11 AM to 5 PM Arizona, the robot's own calling hours (`auto_call_*` settings, read by `readCallHours`). "8 PM tonight" → "Our team is available weekdays 11 to 5. Would tomorrow at 11 work?"
2. **The lead's time zone:** worked out from the area code, and confirmed out loud: "So that's Thursday at 3 PM your time?" Agents see it in Arizona time - Arizona keeps no daylight saving, so 3 PM in New York is 1 PM there in winter and 12 PM in summer.

*As built (A07, 2026-11-11):* `backend/src/ai/callback-time.ts`, pure. `leadTimeZone` maps 353 area codes to a zone - a code across two zones takes the one most of its people are in - and an unknown one gives Arizona's zone with `known: false`, so Seri asks. `checkCallbackTime` accepts a time inside the hours, at least 15 minutes and at most 14 days ahead; refused, it says why (`past`, `too_soon`, `too_far`, `outside_hours`) and offers what a salesperson would: a weekend keeps the time on the lead's clock (Saturday at 3 → Monday at 3), a time outside the hours becomes the next opening (8 PM → tomorrow at 11 Arizona), past or too soon the first quarter hour far enough ahead, too far the same time on the last day in reach. `atLocalTime` reads the wall clock Seri gives ("2026-11-12T15:00") in a zone, one instant whichever clock it was said on. `spokenTime` says it back: "tomorrow at 1 PM your time", "Monday at 3 PM your time", and the date from a week on. Holidays are not known, as they are not to the robot's own hours. The ticket: `ai-agent-tickets/A07-call-back-time-rules.md`.

*As built (A15, 2026-11-12):* `/auto/ai-after` books it with her result, `callback_booked`, in one transaction (`keepCallResult` with `bookAiCallback`, `backend/src/db/callbacks.ts`) - only the request that saved the result, so Twilio asking twice books once, and a unique index keeps one per call besides (`callbacks_one_per_ai_call`, migration 023). A lead who hangs up straight after she booked it still has it booked: the relay's record says so (A14). `reason = 'ai_booked'`, `booked_by_call_id` the call, and her one-line reason as `note` (023). The lead's own agent's when an active one holds the lead; otherwise no agent - open to everyone. Its time is checked again against the hours; refused there - a bug, since the relay checked it before she could book - it is booked all the same and logged (`auto_call.callback_time_refused`). Recorded as `callback.booked`, the system's doing, `via: 'seri'`, with the call and the lead's zone. On the lead's page, while open, a badge: "Callback booked · Thu, Nov 13 3:00 PM · Wants to order antibiotics" - in the viewer's own time, whose it is once someone has it, her line; on the timeline, "Callback booked by Seri for ..."; Admin > Leads' Call column and filter, "Callback booked". Her booking is no person's work: a lead with only that is not Working (`WORKED_SQL`). Seen on the real API: two bookings through `/auto/ai-after` - the unheld lead's open to everyone, the held lead's Maya's, a repeat booking nothing - read back on the lead's page, its timeline and Admin > Leads. `AGENT-WORKSPACE.md`, "Callbacks".

*As built (A16, 2026-11-12):* **due**, a call back of hers puts the lead in the queue on its own - with no score, as the robot's leads have none - and **at the top**, beside a missed "yes", the two sorted together on when the call was promised for (`AI_CALLBACK_DUE_SQL`, `AI_CALLBACK_DUE_AT_SQL`, `db/lead-state.ts`; `promised_at`, `db/queue.ts`). Its row reads "Callback · 3:00 PM" in bold while nobody has it. **Not yet due**, it pushes nothing up. **The first agent to pick the lead up takes it** - `claimLead` makes it theirs in the same statement and records `callback.taken` - and from then it reads "Callback – Maya Chen · 3:00 PM", is on their My Callbacks with her line in the Last note column while the lead has no note, and stays theirs if someone else picks the lead up later. An outcome finishes it. Proved in `scripts/queue-live-check.ts` (84 checks); the queue with 50,000 leads took 74 ms before and 76 ms after (`QUEUE.md`, "How fast it is"). `QUEUE.md`, "The order" and "The tag".

*Changed after A21's call 92 (2026-11-13):* **only a time she said back, and the lead agreed.** With nobody free she had asked "Would you like me to connect you with someone now?"; Jeel said "Yes", and she booked "Monday at 11 AM" - a time she chose herself, never asked or confirmed. In the answer test set she did the same 5 times in 5. Three changes:

- **The booking is refused** unless her reply the lead has just answered named that time - "So that's Monday at 3 PM your time?" - on the lead's clock (`saysClock`, `callback-time.ts`: "3 PM", "3:00 p.m.", "3pm", "noon"; the minutes said unless on the hour). Checked after the hours, so a time outside them is still refused with what to offer. Refused, she is told why and speaks again at once: everyone is busy, when would be a good time? (`NOT_AGREED`, `actions.ts`). The reply it reads is the one the lead answered, never an action of hers refused since (`answeredReply`, `conversation.ts`; the answer test set reads it the same way).
- **The note after an offer to connect** said "if they said yes, go ahead" - with nobody free, going ahead was booking. With nobody it now says to tell them everyone is busy and ask when, and not to book until they have agreed a time (`NO_REPEAT_NOBODY_NOTE`).
- **Her instructions:** with nobody free, never offer to connect them now or ask if they want to talk to someone now; a call back's time is theirs to pick - "a 'yes' to anything else is not a time".

Two cases from call 92 - a plain "Yes" to the offer, and "Yes" to "connect you now?", both with nobody free: 4 of 10 before, 15 of 15 after (`yes_short_nobody` 5 of 5, `connect_yes_nobody` 10 of 10). The whole set, 73 cases, two runs each: 142 of 146; the misses `no_once` and `stop_at_greeting`, each 2 in 5 on `dev` too (a stop said at the greeting is caught by the relay's own stop check before OpenAI), the who-is-there note read back once (dropped before the voice), and `callback_unknown_zone` once - "Are you in Arizona time for that 2 PM?", a zone question in words the case does not list.

*Changed after A21's call 93 (2026-11-13), a Friday at 4:39 PM:* with nobody free she still asked "Would you like me to connect you with someone now?"; asked for "tomorrow at two", she said back "Would 2 PM tomorrow work?" - a Saturday; the booking was refused (outside the hours) and she had to ask again for Monday, so the call repeated itself. Nothing wrong was booked. Two changes - facts and a note, no fixed answer: Jeel, the same day, "i do not make fixed all the answer ... what is the mean of AI agent thinking" - she says it in her own words:

- **The next days with agent hours, worked out for her**, in the call's details (`nextDays`, `instructions.ts`): "today, until 5 PM; Monday, November 16; Tuesday, November 17; Wednesday, November 18. Tomorrow, Saturday, November 14, has none: never agree a call back then." She had "tomorrow is Saturday" and "Monday to Friday" on two lines and did not put them together.
- **A note with every lead turn while nobody is there** (`NOBODY_NOTE`, `leadTurn`): don't offer to connect them now; if they want someone, say everyone is busy and ask when would be a good time for a call back. Her instructions said it already; the note at the moment is what she follows, as with `NO_REPEAT_NOTE`.
- **The answer test set ran every case at its default time**, Wednesday noon, whatever the case said (`loadCases`): a case may now set `now`, and does for call 93's two, `friday_yes_nobody` and `friday_tomorrow_nobody`. On the Friday, before: 13 of 20 - "connect you now" 5 times in 10, a Saturday agreed once. After: 20 of 20, and every case with nobody there, 90 of 90. Asked for the weekend, her own words each time - "Tomorrow is Saturday, and our team doesn't work on weekends. Would Monday at 2 PM your time work for a call back instead?", "Saturdays are outside our agent hours, but we can do the next best time on Monday morning" - and `callback_saturday`, 2 or 3 in 5 before, 5 of 5. The whole set, 76 cases, two runs each: 149 of 152, every check of what she does passing; the three misses brackets dropped before the voice - the who-is-there note read back, `[apathetic]` for `[apologetic]`, and `[pause]`.

**In the database** (migration 022): `callbacks.agent_id` may be null only for a call back Seri books, with the reason `ai_booked` beside `booked` and `missed_call` (008); each names the call it was booked on (`booked_by_call_id`), and 023 adds her `note`. The queue and My Callbacks read it as above. The new result, `callback_booked`, shows on the lead's timeline and in Admin > Leads' Call column and filter like every other result (A15). A "yes" that was put through and that nobody took still uses today's **Wants a call** rule (T22).

---

## 5. What Seri knows

Three JSON files, built 2026-11-11 from the client's emails and a crawl of edrugstore.com, all approved by Jeel:

```
backend/src/ai/
  knowledge/
    answers.json           10 rules, 37 spoken answers (36 approved, 1 open)
    products.json          30 products Seri may name: 7 antibiotics, 4 STI antivirals, the Emergency Medical Kit, 18 test kits
    sales-playbook.json    how Seri talks, 9 objections, closing questions, what she never does
data/edrugstore-site/      the crawl: reference only, never read by the app
```

**Files, not database tables** (Jeel, 2026-11-11). Nobody edits answers from a screen, and every change goes through a PR either way, so tables would add a migration, a loader and a database for the test set, and buy nothing. Not shown on Admin > Configuration either.

- **Loaded when the app starts.** A missing file, a missing field or a bad version stops the API from starting, and the tests catch it before a deploy.
  *As built (A03, 2026-11-11):* `backend/src/ai/knowledge.ts` imports the three files - so the build carries them into `dist/` - and `loadKnowledge()` checks them once and hands them out typed. Every problem in every file is listed, each by file and field (`answers.json: answers[id=price].answer is missing`); `api/index.ts` logs each as `api.refused_start` (`reason: ai_knowledge_invalid`) and exits, whether or not the AI agent is on - a broken file is a bug in the repo. Checked: every field present and not empty; ids and product slugs used once; `status`, product `type` and `rx_required` from their lists; product URLs `https://`; one shared version; an open answer has its `fallback_answer`; no placeholder but `{callback_number}` in anything Seri says. **Two things never get past the loader:** a product's price (the typed product has no field for one), and an open answer's own text (an answer's `spoken` is its `fallback_answer` until it is approved). `api.started` names the version.
- **One version** for all three (`approved-2026-11-13` - businesslike words, and "Who is this?" without the partner sites, section 1, "Her voice and tone"; `approved-2026-11-12` - four speaking-style lines; first `approved-2026-11-11`). Every AI call saves it, so what Seri knew on any call can be traced.
- **All of it goes into Seri's instructions on every call** - about 3,500 words (3,300 at A04; the knowledge files have grown since). No search and no vector database, so an approved answer is never missed. The part that never changes comes first and the call's own details (the greeting, first name, time, the lead's time zone, the hours) last, so OpenAI can reuse what it has already read and start faster. Who is there is not in them: it changes during the call, so it comes with each of the lead's turns (section 3, A11).
  *As built (A04, 2026-11-11):* `backend/src/ai/instructions.ts`, pure: `buildInstructions({ knowledge, lead, now, hours, callbackNumber, stopLine })`. In order: who Seri is and her goal; how she speaks; how the call goes; the three notes of who is there; her five actions with their last lines - the opt-out's is the script's own stop line; the rules and "never"; the objections; the closing questions; every answer by topic, `{callback_number}` read digit by digit (`spokenNumber`, shared with the voicemail); the products by type, names and spoken lines, no price and no web address. Then, under "## This call": the greeting already said, the first name (cleaned - `cleanFirstName`), the time in Arizona, the lead's zone and their time, and the agent hours in both. Every call on one server shares its first 19,000 characters or so. Two lines are not from the files: Seri says she is eDrugstore's virtual assistant if asked whether she is a person (approved by Jeel, 2026-11-11), and an example opening, which waits for his word. `welcomeGreeting` and `whoIsThereNote` live here too, for A13 and A11. The ticket: `ai-agent-tickets/A04-seri-s-instructions-system-prompt.md`.
- **Changing anything:** edit the file, bump the version, run the answer test set (section 8), PR into `dev`. Never edit on the server. The instructions' snapshot test fails on any change, so the PR shows the new text; `npx jest -u src/ai/instructions` writes it once read.

**The rules inside the files:**

- **Seri never quotes prices**, even though `site_price_usd` is stored for reference. It never reaches her instructions.
- An answer's `status` is `approved` (from the client or Jeel) or `needs_confirmation`. One that needs confirmation carries a `fallback_answer`, which is what Seri says until it is confirmed. Only `medical_web` is open (section 11).
- `{callback_number}` in an answer is the number the call came from (`TWILIO_PHONE_NUMBER`), read out digit by digit as the voicemail reads it (`voicemailLine`, T18): production's (480) 470-8259 on the server, the dev number on a laptop.

**Where it came from:** the client's emails of 2026-11-05 (goal, rules, delivery, what not to do) and 2026-11-09 (call questions, objections, products, the offer); edrugstore.com, crawled 2026-11-09 (FAQ, policies, product pages); Jeel's updated legal, safety and privacy wording, and his approvals, 2026-11-09 and 2026-11-11. Each answer names its source.

**The crawl** - `data/edrugstore-site/`, the material the files were written from. **The app never reads it.**

| File | What |
|---|---|
| `site-products.json` / `.csv` | All 186 products on the site: name, category, price, Rx flag (a first guess), description, URL |
| `pages-index.json` | All 576 crawled pages, tagged product, category, info, doctor profile or home |
| `raw/edrugstore-site-crawl.json` | The full crawl, 13 MB. Git-ignored: regenerate rather than commit |

Crawled through a browser from the site's sitemap (blog posts not included). Two pages failed: `/bundles/` and one doctor profile.

**All AI code lives in `backend/src/ai/`** - the switch, the relay, the instructions, the safety check, the test set. Nothing AI-related goes anywhere else in `src/`, apart from the hooks: `/auto/answer` and `/auto/ai-after` (`api/twilio-webhooks.ts`) and their TwiML (`integrations/twilio.ts`, `seriTwiml`); the relay attached in `api/index.ts`; the worker's check before calling (`worker/index.ts`, `worker/auto-calls.ts`); her result and call backs (`db/auto-calls.ts`, `db/callbacks.ts`), the queue (`db/queue.ts`, `db/lead-state.ts`, `core/queue-tags.ts`), claiming (`db/claims.ts`), the voicemail rule and who is coming (`db/auto-calls.ts`, `db/presence.ts`), the timeline (`db/timeline.ts`); the stop check (`core/answers.ts`, `saysStop`); the frontend's `SeriConversation.tsx` and the lead page's badge; and the server command in `src/cli/` that switches her (section 7).

---

## 6. Limits and backups

Decided by Jeel, 2026-11-11.

| Situation | What happens |
|---|---|
| Conversation reaches **3 minutes** | Seri wraps up: offers a person or the link once, then ends. No limit on the number of questions. *As built (A12):* a note to her with her next reply; 20 seconds after the three minutes, the relay ends the call itself - `end_call`, `time_limit` |
| Lead silent **6 seconds** after Seri stops talking (`agentSpeaking` off) | "Hello, are you still there?" Silent again: "Sorry I missed you, have a great day," and the call ends. *As built (A12):* `end_call` with the reason `no_response` |
| OpenAI gives no first word in **4 seconds** | Seri says a filler ("One moment..."); still nothing, the call **switches to today's script**. *As built (A12):* 4 seconds after the filler, `fallback` with `model_slow` |
| OpenAI errors, or the WebSocket or ConversationRelay fails mid-call | The call **switches to today's script** (Twilio posts `SessionStatus=failed` to `/auto/ai-after`). *As built (A12):* an OpenAI error, our socket failing or the relay failing ends the session with `fallback` - `model_failed`, `socket_error`, `relay_failed` - so Twilio posts `ended` with it, or `failed` when the socket is gone; either way the script takes the call (A14). *Since 2026-11-13:* the line dropping - the api restarting, the network - is reconnected by Twilio and the call picked back up where it was (section 2, "When the line drops"); the script takes the call only when that fails |
| **OpenAI down before calling** | **The robot places no calls.** Before each look for leads to call, it checks OpenAI (a tiny request, at most once a minute). Down: nobody is called, it checks again next minute. Each lead gets one robot call, so a lead is never spent on a broken AI. *As built (A17):* the check is a one-word request to her own model (`max_completion_tokens: 1`), 5 seconds at most, no retries, its answer - up or down - kept 60 seconds; asked only inside the hours and with room to place calls, so the robot never checks OpenAI to place nothing. Down - an error, a refused key, no answer - and nothing is placed that look; logged once, `ai_agent.openai_down`, with OpenAI's status and code |
| 3 AI calls fall back in a row (`calls.ai_ended_with = 'fallback'`) | The robot pauses, like the Twilio pause (T28, `REFUSED_PAUSE_MINUTES`), then checks OpenAI again. *As built (A17):* her last three calls whose part ended, all `fallback`, the latest started within 15 minutes; OpenAI is not asked meanwhile. A call the lead hung up on before she ended it has no `ai_ended_with` and neither breaks nor adds to the streak. After the pause the next call tells: another fallback pauses again, anything else ends the streak. Logged once, `ai_agent.fallbacks_paused` |
| A sentence holds a price, medical advice or a made-up discount | **Every sentence is checked before Seri says it.** A price (`$`, "dollars"), advice words ("you should take", "dosage"), or any discount but "up to 25%" is replaced with "That's a great question for one of our specialists. Would you like me to connect you?" Every approved answer and playbook line passes the check unchanged (A05). *As built:* `backend/src/ai/safety.ts`, `checkSentence` - four reasons, `price`, `advice`, `diagnosis`, `discount` (made-up urgency such as "today only" counts as one); the words around a risky word decide, so "I can take you off our list" and "an overdose" pass; what it found is kept with the call's turns, never logged. All 116 lines of the knowledge files pass, sentence by sentence |
| Someone else connects to the WebSocket | The connection request must carry Twilio's signature for our relay URL, checked like every Twilio webhook. The call is named by a `<Parameter>`, which arrives in `setup`. Unsigned, or signed for another URL: closed. *As built (A10):* refused before any WebSocket opens, with a plain 403; and `setup` must name an automated call whose Twilio call is the one connecting, not yet Seri's and not over - section 9 |

### As built (A12, 2026-11-12)

`backend/src/ai/conversation.ts`, beside her replies; the relay passes Twilio's speaker events to it, and starts its clocks once `setup` has started her on the call.

- **The clocks.** Counted from `setup`, which is when Twilio starts her greeting: the three minutes, and the silence. Each on `timers` - the real clock, or one moved by hand in the tests (`ai/fake-clock.ts`) - and all stopped the moment her part ends or the socket closes.
- **Silence** needs Twilio's speaker events (`events="speaker-events"`, which A13 sets). It counts only while nobody is talking and she is not answering: from `agentSpeaking` off, from her reply's end if Twilio's off came first, from `clientSpeaking` off when no words followed (a noise), and again from a key. 6 seconds: "Hello, are you still there?" - said in her voice, kept as hers and put in what OpenAI reads, so she knows she asked. Then counted again from the end of that line; 6 more seconds: "Sorry I missed you, have a great day." and `end_call` with `no_response`. Anything from the lead - words or a key - puts it right: two silences in a row are needed again.
- **Three minutes.** A note to her goes with her next reply, once (`WRAP_UP_NOTE`): answer briefly, then offer once - a person if someone is free or coming, a call back if nobody is, or the link - and ask which they would like; end the call when they answer. Not on its own at the three-minute mark: at that moment the lead may be about to answer her. 20 seconds after the three minutes, if she has not ended the call: a reply she has started saying is said whole - it may be her wrap-up, with its action; OpenAI has 10 seconds more at most to finish writing it - and then, as for one OpenAI has not started, "Thanks so much for your time today. Have a great day!" and `end_call` with `time_limit`. The lead saying more by then gets the goodbye, not another reply.
- **OpenAI slow.** Counted from the start of each reply - a refused action's second try has its own. 4 seconds with no first word: "One moment..." - sent as the start of her reply, so what she says next follows it, and kept as her turn with how long it took; it is not put in what OpenAI reads, or she would start saying it herself. 4 more seconds: the request is stopped, her utterance closed, and `fallback` with `model_slow`.
- **Failing.** OpenAI erroring (`model_failed`) - before or during her reply; what she had said is closed first. Our socket failing (`socket_error`): her part is recorded as a fallback, though Twilio no longer hears the `end` - it posts `failed`. The relay itself failing once she is on the call (`relay_failed`): the session ends with the fallback rather than a dropped socket. Before `setup` has started her there is nothing to end: the socket is closed as before, and Twilio posts `failed`.
- **What is recorded.** Every fallback is `calls.ai_ended_with = 'fallback'` and `ai_agent.ended` with `why` - what the robot counts (A17). A session that closes with no end of ours - the lead hanging up, or Twilio's side failing - is not recorded here: the action URL has `SessionStatus`. It records Twilio's failure (`twilio_failed`, A14); a hang-up leaves `ai_ended_with` null. `ai_relay.closed` says whether her part had ended (`ended`).
- **The logs** never quote OpenAI's error: it can hold part of the key ("Incorrect API key provided: sk-abcd*****wxyz"). Only its status and code - `OpenAI 401 invalid_api_key`, `OpenAI timed out` (`plainError`, `ai/openai.ts`).

**Seen on the real API** (2026-11-12, a scratch database, a fake Twilio client that says each line as Twilio would): "Hello, are you still there?" 6.00 s after `agentSpeaking` off, the goodbye and `end` 6.00 s after that; OpenAI pointed at a server that never answers - "One moment..." at 4.00 s, the fallback at 8.01 s; OpenAI refusing a key - the fallback at 0.56 s. Each recorded on the call and in the activity log as above.

**The wrap-up note on the real model** (`gpt-4.1-mini`, three cases three times each, at the three-minute mark of a conversation): with the first wording ("offer once ... then end the call") she once texted the link with nobody there without asking, and never offered a call back. With the note as built she asked which they would like in all nine, and took no action before an answer. Twice in nine she offered a person with nobody there, as on A11's run - the transfer is refused if they say yes, and she offers a call back; and she sometimes says "someone is free now" in those words. Both for A21 to listen for.

**Not covered:** OpenAI stopping partway through a reply, after its first word - the 15-second request timeout does not cover a stream that stalls; such a call ends with the time limit, three and a half minutes in at the latest. A reply with neither words nor an action (`empty_reply`) says nothing; the silence then asks "are you still there?".

---

## 7. Switches and rollout

| | Where | What |
|---|---|---|
| `OPENAI_API_KEY` | Server `.env` (and local), passed to the api and the worker | From the client, 2026-11-09. Never in the repo. **Without it the AI agent is off, whatever the switch says** |
| **AI agent on/off** | `settings.ai_agent`, changed only by `npm run ai-agent -- on` or `-- off` | On: Seri runs every call. Off: today's script. **Read on every call, so it changes without a restart** - switching it off at 2 PM cuts off no live call |

**As built (A01, 2026-11-11):**

- **The switch is a server command** (Jeel, 2026-11-11), not a hand edit: production's database is changed only by migrations and by the app itself (`WORKFLOW.md`, "Migrations"). On the server: `docker compose -f docker-compose.yml -f docker-compose.prod.yml exec api npm run ai-agent -- on`; locally, `docker compose exec api npm run dev:ai-agent -- on`.
- **Each change is recorded** - `ai_agent.switched` in the activity log, with what it was and what it became, in the same transaction as the change (`AUDIT.md`). Switching it to what it already is changes nothing and records nothing. Two commands at once take turns.
- **`on` is refused without `OPENAI_API_KEY`**, and nothing is written.
- **On without a key counts as off** - the key was taken out of `.env` after switching on, say. Calls go to the script, and the first such call logs `ai_agent.no_key` once.
- **Not a reason to refuse to start**, unlike a half-set Twilio group (`api/startup-checks.ts`): the switch changes while the API runs, so a startup check would catch it only at the next restart - and would take down the queue, the texts and every screen for something whose fallback is today's script.
- The code: `backend/src/ai/settings.ts` (reading and writing the switch), `backend/src/cli/ai-agent.ts` (the command); the key is `config.openai.apiKey`, passed to the api and the worker by `docker-compose.yml`.
- **Packages:** `openai` 6.x and `ws` 8 (with `@types/ws`). `openai` 7 needs Node 22, and the app runs Node 20 (`node:20-alpine`), so it stays on 6 until Node is upgraded - a change of its own.

**Rollout** (Jeel, 2026-11-11): no partial share, no comparison report.

1. Build and test on the dev number, (480) 530-8582, as much as possible
2. Deploy with the AI **off**: calls work exactly as today
3. Switch it **on** with the command: every call goes to Seri

Outside production the robot already rings only `AUTO_CALL_TEST_NUMBERS`, so Seri can only reach our own phones while testing.

Analysis of how calls went is done by hand when wanted: every turn is in the database (section 9), queried on the server.

---

## 8. Testing

| Level | What |
|---|---|
| Unit | Pure functions in `backend/src/ai/`: the switch, the instructions, the sentence check, action to `handoffData`, booking times and time zones, the 3-minute and silence rules. No OpenAI, no Twilio |
| WebSocket | The relay against a fake ConversationRelay and a fake OpenAI: setup, turns, each action, an interruption, a stop word, a timeout, a failure |
| **Answer test set** | About 60 things leads say ("is this a scam", "how much", "I'm driving", "call me tomorrow at 3", "what should I take for a UTI", "stop calling"), each with the action that must follow and words that must not appear. Run against the real model before every change to the knowledge or the instructions: `npm run ai:eval`. The model is chosen by it (speed and answers). *As built (A09):* 67 cases in `backend/src/ai/evals/cases.json`, marked by `grade.ts` - the outcome checked as a call checks it, the words she must and must not say, and the sentence check. `cd backend && OPENAI_API_KEY=... npm run ai:eval` runs Seri's model; `-- --model gpt-5.4-mini:none --runs 2` compares. `gpt-4.1-mini`: 133 of 134, first word 0.55 s. The results and what each run changed: `ai-agent-tickets/A09-answer-test-set.md`. *(A21, 2026-11-13: 68 cases, `no_repeat_connect` added; her words graded without her tones; a bracket that is not one of her tones fails; an action written in brackets is taken as the relay takes it, and counted; the summary counts the replies with a tone - section 1, "Her voice and tone".)* |
| End to end | `npm run e2e` gains robot calls that go to Seri, with Twilio and OpenAI stubbed at their edge. *As built (A20, 2026-11-12):* steps 14-19 of `backend/scripts/end-to-end.ts` - Seri switched on with the command's own function; the robot placing nothing while OpenAI does not answer its check, then calling again; five calls through her real relay on a real server, OpenAI a local server streaming scripted replies and tool calls: a call back (booked with her line, due, first in the queue, taken on pick-up, on My Callbacks), a transfer taken, the link texted once, a stop blocking the number without OpenAI asked, OpenAI failing mid-call and the script taking over to its own result. 131 checks, 34 of them hers; passes on the host and inside the api container. `docs/README.md`, "How to test" |
| Real phone | Every action, talking over Seri, silence, a voicemail, a hang-up, OpenAI switched off mid-call, on the dev number |

---

## 9. What is stored

Following `docs/AUDIT.md`: nothing is lost, add-only.

| Where | What |
|---|---|
| `calls.ai_started_at` | When Seri took the call. Null for a script call |
| `calls.ai_knowledge_version` | Which knowledge version she used |
| `calls.ai_ended_with` | How her part ended: one of the five actions, or `fallback`. Null when the lead hung up first. A fallback call then gets the script's own `script_result`, so this is the only record that Seri failed (A17 counts it). *As built:* written by the relay when she acts (A11) - since A18 a goodbye, the link or a call back only once Twilio's verdict is in, and not at all when the voicemail message took the call - and for every fallback it decides (A12); by the action URL too on `ended`, whichever comes first, and for Twilio's own failure, `twilio_failed` (A14) |
| `calls.script_result` | Adds `callback_booked` |
| `call_ai_turns` (new) | One row per turn: call, who (lead, Seri, action, system), the text, when, how long Seri took to start |
| `callbacks` | Seri's bookings: no agent until taken, reason `ai_booked`. *As built (A15):* with her one-line reason, `note` (migration 023), the lead's own agent's when an active one holds the lead, one per call |
| `activity_log` | `ai_agent.switched` (built, A01); `ai_agent.started` (built, A10), `ai_agent.ended` with the action (built, A11), and `why` for a fallback (A12); `ai_agent.reconnected` when the line dropped and the call was picked back up (2026-11-13, section 2); `callback.booked` with `via: 'seri'` (A15) and `callback.taken` when an agent picks the lead up (A16) |

The words are never written to the logs, the same rule as `auto_call.answer` today.

*As built (A08, migration 022, 2026-11-11):* the columns and the table above, with the database keeping their rules - `ai_started_at` and `ai_knowledge_version` written together, `ai_ended_with` only after a start, all three only on an automated call; `call_ai_turns` add-only by trigger, `who` one of the four, `latency_ms` only on Seri's turns; a callback with no agent only when it is `ai_booked`, and every `ai_booked` one naming its call (`booked_by_call_id`); and `settings.ai_agent` seeded `off`, never over a value the command already wrote. `scripts/ai-agent-live-check.ts` proves each rule, 34 checks then (116 by A18, with the checks of A10-A18).

*As built (A10, 2026-11-12) - the relay, the pipe:* `backend/src/ai/relay.ts`, a WebSocket on the API's own server at `/api/ai/relay` (`ws`, attached in `api/index.ts`), only with automated calls on, like their webhooks.

- **Who may connect:** the request must carry Twilio's signature for `wss://` + `PUBLIC_URL`'s host + the path and query it asked for, with no parameters (`relaySigned`, `ai/relay-messages.ts`, as A02 found). Anything else is refused before a WebSocket opens - 403, or 404 for another path. Then the first message must be `setup`, within 10 seconds.
- **Which call:** `setup` names our row in `customParameters.call` (A13's `<Parameter name="call">`). `startAiCall` (`ai/relay-store.ts`) marks `ai_started_at` and `ai_knowledge_version`, and records `ai_agent.started`, in one transaction - only for an automated call whose `twilio_call_sid` is the `callSid` connecting, not yet Seri's, not ended and with no script result. One UPDATE decides, so two connections for one call cannot both start it; the other is closed (code 1008), and the log says why.
- **Every turn kept, in order:** her greeting first - Twilio says it (A13), from the same `welcomeGreeting` - then the lead's final words (`last: true`; a partial or empty prompt is not a turn), each of her lines with `latency_ms`, a key as the lead's `(pressed 1)`, and as `system` notes being cut off (`Cut off. Heard: "..."`) and Twilio's errors - which can quote her words, so they are kept here and not logged. Messages are handled one at a time in the order they came, so a prompt that arrives while `setup` is still being saved waits for it. A turn the database refuses is logged (`ai_relay.turn_not_saved`) and the call goes on.
- **What Seri said, in A10:** one fixed line to everything, a stand-in until A11 gave her OpenAI - section 1, "How a reply is made". Calls have reached the relay since A13 (section 2).
- **Tested:** `relay.test.ts` - a real WebSocket on a real server, a fake ConversationRelay sending A02's messages, a fake database (21 tests); `relay-messages.test.ts` (17); 1,447 backend tests in all. The SQL on a real Postgres - started once, two connections racing, each refusal, nothing recorded for one, turns in order: `scripts/ai-agent-live-check.ts`, 51 checks. And once by hand: the real API on a scratch database with calling and automated calls on, a fake client signing as Twilio - started, four turns, the activity row; a second connection and an unsigned one refused.

**On screen:** under the robot call on the lead's timeline (T21, `CallAnswers`), Seri's conversation as a short chat: what the lead said, what Seri answered, how it ended. It is there for **the agent** who takes the transfer or the call back, so the lead does not repeat themselves. Nothing new on Admin.

*As built (A19, 2026-11-12):* a fold of its own, **Seri**, beside **Answers** and **Transcript** and closed like them (`components/SeriConversation.tsx`), on the workspace conversation and the Lead Timeline: "Lead" and "Seri" lines in order, then how her part ended - "Booked a call back: Mon, Nov 16 3:00 PM", "Put through to a person", "Texted the link", "Ended - not interested", "Seri stopped - the call went on with the script". From the call's timeline entry, `detail.seri` (`seriPart`, `db/timeline.ts`): the lead's and her turns - notes left out - and the action `ai_ended_with` records, read from her `action` turn; a choice never carried out (the voicemail took the call) and a hang-up show none. `AGENT-WORKSPACE.md`, "The timeline".

---

## 10. Not in this phase

- A self-improving AI (why leads hang up or say no) - a future phase
- Seri answering a lead calling back when nobody is free, or off hours
- Taking payment or personal details, ever
- Languages other than English

## 11. Open

- "What is Medical Web?" (the caller ID name): until confirmed, Seri says only `medical_web`'s `fallback_answer`, "We're calling on behalf of eDrugstore."

---

## Build tracker

The build is split into 22 small tickets, A01 to A22, one PR into `dev` each: **`docs/ai-agent-tickets/README.md`** has the list, the order and each ticket's status. As of 2026-11-13, A01-A20 are built and on `dev`; A21 (every path on a real phone) and A22 (deploy with her off, then switch her on) are Jeel's. The counts in the "As built" notes are as they stood that day: 1,634 backend and 432 frontend tests, 23 live checks (`ai-agent-live-check` 116), `npm run e2e` 131 checks as of 2026-11-13. Each ticket says what to build, which files, what done means, the tests and the docs to update.
